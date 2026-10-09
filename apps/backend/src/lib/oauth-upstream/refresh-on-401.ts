// Server-side refresh-on-401 helper for the upstream proxy path.
//
// The backend's MCP client (`apps/backend/src/lib/metamcp/client.ts`) does
// not pass an OAuthClientProvider into the SDK transports, so the SDK has
// no built-in path to refresh tokens when the upstream returns 401. This
// helper closes that gap: it reads the persisted oauth_sessions row,
// POSTs `grant_type=refresh_token` to the upstream's token endpoint, and
// persists the new tokens back into the DB so the next connection attempt
// picks them up.
//
// Concurrency: an in-process per-server mutex (`inFlightRefreshes`)
// collapses simultaneous refresh attempts for the same MCP server into
// one upstream POST. Without this, providers that rotate refresh tokens
// (Google, Microsoft, Okta with rotation enabled) would consume the
// refresh_token on the first attempt and reject the second with
// `invalid_grant`, leaving one of the two connections stranded. The
// mutex is in-process only; multi-instance deployments still race across
// processes (acceptable cost for now — a DB-level CAS would be the
// follow-up).
//
// Acceptance criterion #3 from the OAuth-CORS-fix PR.

import { ServerParameters } from "@repo/zod-types";

import { oauthSessionsRepository } from "../../db/repositories";
import logger from "../../utils/logger";
import {
  discoverAuthorizationServerMetadata,
  OAuthTokens,
  redactToken,
  refreshAccessToken,
  resolveOAuthResource,
  resolveTokenEndpoint,
  resolveTokenEndpointAuthMethod,
  UpstreamTokenError,
} from "./token-exchange";

// Refresh this long before the access token's expiry so the pooled
// connection is rebuilt with a live bearer instead of dying on the hour.
export const OAUTH_REFRESH_SKEW_MS = 5 * 60 * 1000;

export function stampAccessTokenExpiry(
  tokens: OAuthTokens,
  now = Date.now(),
): OAuthTokens {
  if (
    typeof tokens.expires_in === "number" &&
    Number.isFinite(tokens.expires_in)
  ) {
    tokens.expires_at = now + tokens.expires_in * 1000;
  }
  return tokens;
}

export function accessTokenExpiresAtMs(
  tokens: { expires_in?: number; expires_at?: unknown },
  updatedAt?: Date | string | null,
): number | null {
  const raw = tokens.expires_at;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  if (
    typeof tokens.expires_in === "number" &&
    Number.isFinite(tokens.expires_in) &&
    updatedAt
  ) {
    const base =
      updatedAt instanceof Date
        ? updatedAt.getTime()
        : Date.parse(String(updatedAt));
    if (!Number.isNaN(base)) {
      return base + tokens.expires_in * 1000;
    }
  }
  return null;
}

export function accessTokenNeedsRefresh(
  tokens: {
    expires_in?: number;
    expires_at?: unknown;
    refresh_token?: string;
  },
  updatedAt?: Date | string | null,
  now = Date.now(),
  skewMs = OAUTH_REFRESH_SKEW_MS,
): boolean {
  if (!tokens.refresh_token) {
    return false;
  }
  const expiresAt = accessTokenExpiresAtMs(tokens, updatedAt);
  if (expiresAt === null) {
    return false;
  }
  return expiresAt - now <= skewMs;
}

export function applyRefreshedOAuthTokens(
  serverParams: { oauth_tokens?: ServerParameters["oauth_tokens"] },
  tokens: OAuthTokens,
): void {
  serverParams.oauth_tokens = {
    access_token: tokens.access_token,
    token_type: tokens.token_type,
    expires_in:
      typeof tokens.expires_in === "number" ? tokens.expires_in : undefined,
    scope: typeof tokens.scope === "string" ? tokens.scope : undefined,
    refresh_token:
      typeof tokens.refresh_token === "string"
        ? tokens.refresh_token
        : serverParams.oauth_tokens?.refresh_token,
  };
}

export interface RefreshResult {
  status:
    | "refreshed"
    | "no_refresh_token"
    | "no_session"
    | "no_client_id"
    | "failed";
  tokens?: OAuthTokens;
  error?: string;
  errorDescription?: string;
  upstreamStatus?: number;
}

// Per-server in-flight refresh promises. Concurrent callers for the same
// MCP server share the same upstream POST instead of racing on rotating
// refresh tokens. The map is cleared in a `finally` so a refresh failure
// doesn't permanently pin the server. Exposed for tests; do not depend on
// it from production code.
export const inFlightRefreshes = new Map<string, Promise<RefreshResult>>();

// Attempt to refresh upstream OAuth tokens for an MCP server. Returns a
// status describing what happened. Persists new tokens on success.
//
// NOTE: This is intentionally safe to call repeatedly — it short-circuits
// when there is no refresh_token or no client_id to use.
export async function tryRefreshUpstreamTokens(
  serverParams: Pick<ServerParameters, "uuid" | "name" | "url">,
): Promise<RefreshResult> {
  const inFlight = inFlightRefreshes.get(serverParams.uuid);
  if (inFlight) {
    logger.info(
      `[oauth] refresh already in flight for ${serverParams.uuid}; joining`,
    );
    return inFlight;
  }
  const promise = (async () => {
    try {
      return await doRefresh(serverParams);
    } finally {
      inFlightRefreshes.delete(serverParams.uuid);
    }
  })();
  inFlightRefreshes.set(serverParams.uuid, promise);
  return promise;
}

async function doRefresh(
  serverParams: Pick<ServerParameters, "uuid" | "name" | "url">,
): Promise<RefreshResult> {
  if (!serverParams.url) {
    return { status: "no_session" };
  }

  const session = await oauthSessionsRepository.findByMcpServerUuid(
    serverParams.uuid,
  );
  if (!session) {
    return { status: "no_session" };
  }

  const currentTokens = session.tokens as
    | (OAuthTokens & { refresh_token?: string })
    | null;
  if (!currentTokens?.refresh_token) {
    return { status: "no_refresh_token" };
  }

  const clientInformation = session.client_information as Record<
    string,
    unknown
  > | null;
  const clientId =
    clientInformation && typeof clientInformation.client_id === "string"
      ? (clientInformation.client_id as string)
      : null;
  if (!clientId) {
    return { status: "no_client_id" };
  }
  const clientSecret =
    typeof clientInformation?.client_secret === "string"
      ? (clientInformation.client_secret as string)
      : undefined;

  const discovered = await discoverAuthorizationServerMetadata(
    serverParams.url,
  );
  const tokenEndpoint = resolveTokenEndpoint({
    clientInformation,
    discovered,
    serverUrl: serverParams.url,
  });
  const authMethod = resolveTokenEndpointAuthMethod({
    clientInformation,
    discovered,
    hasSecret: Boolean(clientSecret),
  });

  const resource = await resolveOAuthResource(serverParams.url);

  logger.info(
    `[oauth] refreshing tokens — server=${serverParams.uuid} ` +
      `(${serverParams.name}) token_endpoint=${tokenEndpoint} ` +
      `auth_method=${authMethod} ` +
      `resource=${resource ?? "<omitted>"} ` +
      `refresh_token=${redactToken(currentTokens.refresh_token)}`,
  );

  let newTokens: OAuthTokens;
  try {
    newTokens = await refreshAccessToken({
      tokenEndpoint,
      refreshToken: currentTokens.refresh_token,
      clientId,
      clientSecret,
      authMethod,
      resource,
      scope:
        typeof currentTokens.scope === "string"
          ? currentTokens.scope
          : undefined,
    });
  } catch (error) {
    if (error instanceof UpstreamTokenError) {
      logger.warn(
        `[oauth] proxy refresh failed — server=${serverParams.uuid} ` +
          `status=${error.status} error=${error.oauthError?.error ?? "unknown"}`,
      );
      return {
        status: "failed",
        error: error.oauthError?.error ?? "upstream_error",
        errorDescription: error.oauthError?.error_description ?? error.message,
        upstreamStatus: error.status,
      };
    }
    logger.error(
      `[oauth] proxy refresh threw — server=${serverParams.uuid}:`,
      error,
    );
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "internal_error",
    };
  }

  stampAccessTokenExpiry(newTokens);

  await oauthSessionsRepository.upsert({
    mcp_server_uuid: serverParams.uuid,
    tokens: newTokens,
  });

  logger.info(
    `[oauth] proxy refresh succeeded — server=${serverParams.uuid} ` +
      `access_token=${redactToken(newTokens.access_token)}`,
  );

  return { status: "refreshed", tokens: newTokens };
}

// Refresh only when the stored access token is expired or inside the skew
// window. Callers (the idle-pool health check) use this so OAuth MCP
// servers keep a live bearer without someone opening the server page.
// A still-valid token returns `{ status: "fresh" }` and does not touch
// the upstream.
export async function refreshUpstreamTokensIfExpiring(
  serverParams: Pick<ServerParameters, "uuid" | "name" | "url">,
  now = Date.now(),
): Promise<RefreshResult | { status: "fresh" }> {
  const session = await oauthSessionsRepository.findByMcpServerUuid(
    serverParams.uuid,
  );
  const tokens = session?.tokens as
    | (OAuthTokens & { refresh_token?: string })
    | null
    | undefined;
  if (!session || !tokens?.refresh_token) {
    return { status: "fresh" };
  }
  if (!accessTokenNeedsRefresh(tokens, session.updated_at, now)) {
    return { status: "fresh" };
  }
  logger.info(
    `[oauth] access token expiring — refreshing ahead of disconnect ` +
      `server=${serverParams.uuid} (${serverParams.name})`,
  );
  return tryRefreshUpstreamTokens(serverParams);
}
