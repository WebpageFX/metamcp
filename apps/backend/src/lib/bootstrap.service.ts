import crypto from "node:crypto";
import fs from "node:fs";

import {
  ConfigKeyEnum,
  McpServerErrorStatusEnum,
  McpServerStatusEnum,
  McpServerTypeEnum,
} from "@repo/zod-types";
import { and, eq, isNull, notInArray } from "drizzle-orm";

import { auth } from "../auth";
import { db } from "../db";
import {
  accountsTable,
  apiKeysTable,
  configTable,
  endpointsTable,
  mcpServersTable,
  namespaceServerMappingsTable,
  namespacesTable,
  usersTable,
} from "../db/schema";
import {
  discoverAndApplyToolsPolicy,
  McpServerToolsConfig,
  normalizeToolsConfig,
  saveToolsPolicy,
} from "./bootstrap-tools-policy";

/**
 * Environment-based bootstrap for MetaMCP.
 * Supports arrays of Users, API Keys, MCP Servers, Namespaces, and Endpoints
 * via JSON environment variables.
 */

type UserConfig = {
  email: string;
  password: string;
  name?: string;
};

type ApiKeyConfig = {
  name: string;
  is_public?: boolean;
  user_email?: string; // Email of user who owns this key (for private keys)
  owner?: string; // Alias for user_email
};

type NamespaceConfig = {
  name: string;
  description?: string;
  is_public?: boolean;
  user_email?: string; // Email of user who owns this namespace (for private namespaces)
  owner?: string; // Alias for user_email
  update?: boolean;
};

type EndpointConfig = {
  name: string;
  description?: string;
  enable_auth?: boolean;
  enable_auth_query?: boolean;
  enable_auth_oauth?: boolean;
  is_public?: boolean;
  user_email?: string; // Email of user who owns this endpoint (for private endpoints)
  owner?: string; // Alias for user_email
  namespace?: string; // Name of namespace where endpoint should be created (optional, defaults to first available)
  update?: boolean;
};

type McpServerEndpointConfig = {
  name?: string;
  description?: string;
  enable_auth?: boolean;
  enable_auth_query?: boolean;
  enable_auth_oauth?: boolean;
  is_public?: boolean;
};

type McpServerConfig = {
  name: string;
  type?: string;
  description?: string;
  url?: string;
  headers?: Record<string, string>;
  bearerToken?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  forward_headers?: Record<string, string>;
  is_public?: boolean;
  user_email?: string;
  owner?: string;
  update?: boolean;
  /**
   * When true, also create/update a namespace + ACTIVE mapping + endpoint named
   * after this server (auth disabled by default). Replaces external seed scripts.
   */
  expose?: boolean;
  /** Optional explicit namespace name to create/map into (defaults to server name when expose=true). */
  namespace?: string;
  /** Optional endpoint overrides when expose=true, or false to skip endpoint creation. */
  endpoint?: boolean | McpServerEndpointConfig;
  /**
   * Optional default tool visibility for the exposed namespace.
   * Applied after connecting to the upstream server and listing tools.
   * Policy is also persisted so later "Refresh tools" re-applies it.
   */
  tools?: McpServerToolsConfig;
};

type EnvConfig = {
  // Single user (legacy support)
  defaultUserEmail?: string;
  defaultUserPassword?: string;
  defaultUserName: string;

  // Multiple users (new)
  users: UserConfig[];

  // User management
  deleteOtherUsers: boolean;

  // User lifecycle / safety
  recreateDefaultUser: boolean;
  preserveApiKeysOnRecreate: boolean;
  warnOnPasswordChange: boolean;
  bootstrapOnlyOnFirstRun: boolean;

  // Registration controls
  disableUiRegistration: boolean;
  disableSsoRegistration: boolean;

  // Array configurations
  apiKeys: ApiKeyConfig[];
  mcpServers: McpServerConfig[];
  namespaces: NamespaceConfig[];
  endpoints: EndpointConfig[];
};

const BOOTSTRAP_COMPLETE_KEY = "BOOTSTRAP_COMPLETE";
const BOOTSTRAP_USER_PASSWORD_FP_PREFIX =
  "BOOTSTRAP_USER_PASSWORD_FINGERPRINT_";
const ENV_PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function parseBool(value: string | undefined, def: boolean): boolean {
  if (value === undefined) return def;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return def;
}

function nonEmpty(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function generateApiKey(): string {
  return `sk_mt_${crypto.randomBytes(32).toString("hex")}`; // 64 hex chars
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 14) return `${key.slice(0, 6)}…`;
  return `${key.slice(0, 10)}…${key.slice(-4)}`;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function parseJsonArray<T>(envVar: string | undefined, defaultValue: T[]): T[] {
  if (!envVar) return defaultValue;

  try {
    const parsed = JSON.parse(envVar);
    if (!Array.isArray(parsed)) {
      console.warn(
        `⚠️ Environment variable is not an array, using default: ${envVar.slice(0, 50)}...`,
      );
      return defaultValue;
    }
    return parsed as T[];
  } catch (err) {
    console.warn(
      `⚠️ Failed to parse JSON array from environment variable: ${err}`,
    );
    return defaultValue;
  }
}

/**
 * Resolve ${VAR} placeholders from process.env (needed for HTTP url/headers;
 * MetaMCP only interpolates STDIO env at runtime).
 */
function resolveEnvPlaceholders(
  value: string,
  context: string,
): string {
  const missing = new Set<string>();
  const out = value.replace(ENV_PLACEHOLDER, (match, key: string) => {
    const envVal = process.env[key];
    if (envVal === undefined || envVal === "") {
      missing.add(key);
      return match;
    }
    return envVal;
  });
  if (missing.size > 0) {
    console.warn(
      `⚠️ ${context}: unresolved/empty env: ${Array.from(missing).sort().join(", ")}`,
    );
  }
  return out;
}

function resolveEnvValue(
  value: unknown,
  context: string,
): unknown {
  if (typeof value === "string") {
    return resolveEnvPlaceholders(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => resolveEnvValue(item, `${context}[${i}]`));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveEnvValue(v, `${context}.${k}`);
    }
    return out;
  }
  return value;
}

function normalizeMcpServerType(
  raw: string | undefined,
): (typeof McpServerTypeEnum.enum)[keyof typeof McpServerTypeEnum.enum] {
  const upper = (raw || "STDIO").toUpperCase().replace(/-/g, "_");
  if (upper === "STDIO" || upper === "STD") {
    return McpServerTypeEnum.enum.STDIO;
  }
  if (upper === "SSE") {
    return McpServerTypeEnum.enum.SSE;
  }
  if (
    upper === "STREAMABLE_HTTP" ||
    upper === "STREAMABLEHTTP" ||
    upper === "HTTP"
  ) {
    return McpServerTypeEnum.enum.STREAMABLE_HTTP;
  }
  console.warn(`⚠️ Unknown MCP server type "${raw}", defaulting to STDIO`);
  return McpServerTypeEnum.enum.STDIO;
}

function normalizeMcpServersPayload(
  parsed: unknown,
  defaultExpose: boolean,
): McpServerConfig[] {
  if (Array.isArray(parsed)) {
    return (parsed as McpServerConfig[]).map((server) => ({
      ...server,
      expose: server.expose ?? defaultExpose,
    }));
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "mcpServers" in (parsed as Record<string, unknown>) &&
    typeof (parsed as { mcpServers: unknown }).mcpServers === "object" &&
    (parsed as { mcpServers: unknown }).mcpServers !== null
  ) {
    const servers = (parsed as { mcpServers: Record<string, Omit<McpServerConfig, "name">> })
      .mcpServers;
    return Object.entries(servers).map(([name, cfg]) => ({
      name,
      ...cfg,
      expose: cfg.expose ?? defaultExpose,
    }));
  }

  console.warn(
    "⚠️ BOOTSTRAP_MCP_SERVERS payload must be a JSON array or { mcpServers: { ... } }",
  );
  return [];
}

function parseMcpServersConfig(): McpServerConfig[] {
  const defaultExpose = parseBool(
    process.env.BOOTSTRAP_MCP_SERVERS_EXPOSE,
    false,
  );

  const inline = nonEmpty(process.env.BOOTSTRAP_MCP_SERVERS);
  if (inline) {
    try {
      return normalizeMcpServersPayload(JSON.parse(inline), defaultExpose);
    } catch (err) {
      console.warn(`⚠️ Failed to parse BOOTSTRAP_MCP_SERVERS: ${err}`);
      return [];
    }
  }

  const filePath = nonEmpty(process.env.BOOTSTRAP_MCP_SERVERS_FILE);
  if (filePath) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      return normalizeMcpServersPayload(JSON.parse(raw), defaultExpose);
    } catch (err) {
      console.warn(
        `⚠️ Failed to read/parse BOOTSTRAP_MCP_SERVERS_FILE (${filePath}): ${err}`,
      );
      return [];
    }
  }

  return [];
}

/**
 * Get owner email from config object. Supports both "user_email" and "owner" field names.
 * Returns user_email if present, otherwise returns owner, otherwise returns undefined.
 */
function getOwnerEmail(config: {
  user_email?: string;
  owner?: string;
}): string | undefined {
  return config.user_email ?? config.owner;
}

function parseEnvConfig(): EnvConfig {
  // Parse users array
  const usersArray = parseJsonArray<UserConfig>(
    process.env.BOOTSTRAP_USERS,
    [],
  );

  // If single user config exists and users array is empty, add it to array
  const singleUserEmail = nonEmpty(process.env.BOOTSTRAP_USER_EMAIL);
  const singleUserPassword = nonEmpty(process.env.BOOTSTRAP_USER_PASSWORD);

  if (singleUserEmail && singleUserPassword && usersArray.length === 0) {
    usersArray.push({
      email: singleUserEmail,
      password: singleUserPassword,
      name: nonEmpty(process.env.BOOTSTRAP_USER_NAME) ?? "Administrator",
    });
  }

  return {
    // Single user (legacy - for backwards compatibility in some contexts)
    defaultUserEmail: singleUserEmail,
    defaultUserPassword: singleUserPassword,
    defaultUserName:
      nonEmpty(process.env.BOOTSTRAP_USER_NAME) ?? "Administrator",

    // Multiple users
    users: usersArray,

    deleteOtherUsers: parseBool(
      process.env.BOOTSTRAP_DELETE_OTHER_USERS,
      false,
    ),

    recreateDefaultUser: parseBool(process.env.BOOTSTRAP_RECREATE_USER, false),
    preserveApiKeysOnRecreate: parseBool(
      process.env.BOOTSTRAP_PRESERVE_API_KEYS,
      true,
    ),
    warnOnPasswordChange: parseBool(
      process.env.BOOTSTRAP_WARN_PASSWORD_CHANGE,
      true,
    ),
    bootstrapOnlyOnFirstRun: parseBool(
      process.env.BOOTSTRAP_ONLY_FIRST_RUN,
      false,
    ),

    // Registration controls
    disableUiRegistration: parseBool(
      process.env.BOOTSTRAP_DISABLE_REGISTRATION_UI,
      false,
    ),
    disableSsoRegistration: parseBool(
      process.env.BOOTSTRAP_DISABLE_REGISTRATION_SSO,
      false,
    ),

    // Array configurations
    apiKeys: parseJsonArray<ApiKeyConfig>(process.env.BOOTSTRAP_API_KEYS, []),
    mcpServers: parseMcpServersConfig(),
    namespaces: parseJsonArray<NamespaceConfig>(
      process.env.BOOTSTRAP_NAMESPACES,
      [],
    ),
    endpoints: parseJsonArray<EndpointConfig>(
      process.env.BOOTSTRAP_ENDPOINTS,
      [],
    ),
  };
}

async function upsertConfig(key: string, value: string, description?: string) {
  await db
    .insert(configTable)
    .values({
      id: key,
      value,
      description,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [configTable.id],
      set: { value, description, updated_at: new Date() },
    });
}

async function getConfigValue(key: string): Promise<string | null> {
  const row = await db.query.configTable.findFirst({
    where: eq(configTable.id, key),
  });
  return row?.value ?? null;
}

async function shouldSkipBootstrap(config: EnvConfig): Promise<boolean> {
  if (!config.bootstrapOnlyOnFirstRun) return false;

  try {
    const v = await getConfigValue(BOOTSTRAP_COMPLETE_KEY);
    if (v === "true") {
      console.log(
        "✓ Bootstrap already completed; BOOTSTRAP_ONLY_FIRST_RUN=true (skipping one-time bootstrap steps)",
      );
      return true;
    }
  } catch (err) {
    console.warn(
      "⚠️ Failed to read BOOTSTRAP_COMPLETE marker; proceeding with bootstrap.",
      err,
    );
  }

  return false;
}

async function markBootstrapComplete(): Promise<void> {
  try {
    await upsertConfig(
      BOOTSTRAP_COMPLETE_KEY,
      "true",
      "One-time bootstrap completion marker",
    );
  } catch (err) {
    console.warn("⚠️ Failed to write BOOTSTRAP_COMPLETE marker:", err);
  }
}

async function warnIfPasswordChanged(
  email: string,
  password: string,
  warnOnChange: boolean,
  hasExistingUser: boolean,
  recreateUser: boolean,
): Promise<void> {
  if (!warnOnChange) return;
  if (!hasExistingUser) return;

  try {
    const currentFp = sha256Hex(password);
    const fpKey = `${BOOTSTRAP_USER_PASSWORD_FP_PREFIX}${email}`;
    const previousFp = await getConfigValue(fpKey);

    if (previousFp && previousFp !== currentFp && !recreateUser) {
      console.warn(
        `⚠️ Password for ${email} appears to have changed since last applied.`,
      );
      console.warn(
        "⚠️ BOOTSTRAP_RECREATE_USER=false so the existing user's password will NOT be updated.",
      );
      console.warn(
        "⚠️ To force the environment password to apply, set BOOTSTRAP_RECREATE_USER=true.",
      );
    }
  } catch (err) {
    console.warn(
      `⚠️ Failed password-change detection for ${email} (ignored):`,
      err,
    );
  }
}

async function recordPasswordFingerprint(
  email: string,
  password: string,
): Promise<void> {
  try {
    const fpKey = `${BOOTSTRAP_USER_PASSWORD_FP_PREFIX}${email}`;
    await upsertConfig(
      fpKey,
      sha256Hex(password),
      `Fingerprint of last-applied password for ${email}`,
    );
  } catch (err) {
    console.warn(`⚠️ Failed to store password fingerprint for ${email}:`, err);
  }
}

/**
 * Ensure a single user exists.
 */
async function ensureUser(
  userConfig: UserConfig,
  config: EnvConfig,
): Promise<{
  userId?: string;
  email: string;
  recreated: boolean;
}> {
  const email = userConfig.email;
  const password = userConfig.password;
  const name = userConfig.name ?? "User";

  console.log(`🔧 Initializing user: ${email}`);

  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, email),
  });

  await warnIfPasswordChanged(
    email,
    password,
    config.warnOnPasswordChange,
    !!existing,
    config.recreateDefaultUser,
  );

  let preservedUserApiKeys:
    | { name: string; key: string; is_active: boolean }[]
    | undefined;

  let recreated = false;

  if (existing && config.recreateDefaultUser) {
    recreated = true;
    console.warn(
      `⚠️ BOOTSTRAP_RECREATE_USER=true — deleting existing user ${email} to reapply password via Better Auth`,
    );

    if (config.preserveApiKeysOnRecreate) {
      try {
        preservedUserApiKeys = await db
          .select({
            name: apiKeysTable.name,
            key: apiKeysTable.key,
            is_active: apiKeysTable.is_active,
          })
          .from(apiKeysTable)
          .where(eq(apiKeysTable.user_id, existing.id));
      } catch (err) {
        console.warn(`⚠️ Failed to preserve API keys for ${email}:`, err);
      }
    }

    try {
      await db
        .delete(accountsTable)
        .where(eq(accountsTable.userId, existing.id));
    } catch (err) {
      console.warn(`⚠️ Failed to delete accounts for ${email}:`, err);
    }

    try {
      await db
        .delete(apiKeysTable)
        .where(eq(apiKeysTable.user_id, existing.id));
    } catch (err) {
      console.warn(
        `⚠️ Failed to delete user-scoped API keys for ${email}:`,
        err,
      );
    }

    try {
      await db.delete(usersTable).where(eq(usersTable.id, existing.id));
    } catch (err) {
      console.warn(`⚠️ Failed to delete existing user ${email}:`, err);
    }
  }

  if (!existing || recreated) {
    // Create via Better Auth
    const request = new Request("http://internal/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        name,
      }),
    });

    const response = await auth.handler(request);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(
        `⚠️ Better Auth sign-up failed for ${email} (${response.status}). Continuing startup. ${
          body ? `Response: ${body}` : ""
        }`,
      );
      return { email, recreated };
    }
  }

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, email),
  });

  if (!user) {
    console.warn(`⚠️ User ${email} not found after signup; skipping.`);
    return { email, recreated };
  }

  // Keep metadata consistent
  try {
    await db
      .update(usersTable)
      .set({
        name,
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));
  } catch (err) {
    console.warn(`⚠️ Failed to update user metadata for ${email}:`, err);
  }

  // Restore preserved keys if recreated
  if (recreated && config.preserveApiKeysOnRecreate && preservedUserApiKeys) {
    for (const k of preservedUserApiKeys) {
      try {
        await db
          .insert(apiKeysTable)
          .values({
            name: k.name,
            key: k.key,
            user_id: user.id,
            is_active: k.is_active,
          })
          .onConflictDoUpdate({
            target: [apiKeysTable.user_id, apiKeysTable.name],
            set: { key: k.key, is_active: k.is_active },
          });
      } catch (err) {
        console.warn(
          `⚠️ Failed to restore preserved API key for ${email}:`,
          err,
        );
      }
    }

    console.log(`✓ Restored preserved API keys for recreated user ${email}`);
  }

  // Record fingerprint when we actually create/recreate
  if (!existing || recreated) {
    await recordPasswordFingerprint(email, password);
  }

  console.log(`✓ User ready: ${email}`);
  return { userId: user.id, email, recreated };
}

/**
 * Bootstrap all users from configuration.
 */
async function bootstrapUsers(config: EnvConfig): Promise<Map<string, string>> {
  const userMap = new Map<string, string>(); // email -> userId

  if (!config.users || config.users.length === 0) {
    console.warn(
      "⚠️ No users configured for bootstrap (BOOTSTRAP_USERS is empty and no single user config found)",
    );
    return userMap;
  }

  console.log(`👥 Bootstrapping ${config.users.length} user(s)...`);

  for (const userConfig of config.users) {
    try {
      if (!userConfig.email || !userConfig.password) {
        console.warn("⚠️ User config missing email or password; skipping");
        continue;
      }

      const result = await ensureUser(userConfig, config);
      if (result.userId) {
        userMap.set(result.email, result.userId);
      }
    } catch (err) {
      console.warn(`⚠️ Failed to bootstrap user ${userConfig.email}:`, err);
    }
  }

  return userMap;
}

async function maybeDeleteOtherUsers(
  config: EnvConfig,
  bootstrappedEmails: string[],
): Promise<void> {
  if (!config.deleteOtherUsers) return;
  if (bootstrappedEmails.length === 0) {
    console.warn(
      "⚠️ BOOTSTRAP_DELETE_OTHER_USERS=true but no bootstrapped users found; skipping to avoid lockout.",
    );
    return;
  }

  console.warn(
    `⚠️ BOOTSTRAP_DELETE_OTHER_USERS=true — deleting all users except bootstrapped users`,
  );

  try {
    await db
      .delete(usersTable)
      .where(notInArray(usersTable.email, bootstrappedEmails));
    console.log("✓ Deleted other users");
  } catch (err) {
    console.warn("⚠️ Failed to delete other users:", err);
  }
}

/**
 * Bootstrap API keys from configuration array.
 */
async function bootstrapApiKeys(
  config: EnvConfig,
  userMap: Map<string, string>,
): Promise<void> {
  if (!config.apiKeys || config.apiKeys.length === 0) {
    console.log(
      "ℹ️ No API keys configured for bootstrap (BOOTSTRAP_API_KEYS is empty)",
    );
    return;
  }

  console.log(`🔑 Bootstrapping ${config.apiKeys.length} API key(s)...`);

  for (const apiKeyConfig of config.apiKeys) {
    try {
      const name = apiKeyConfig.name;
      const isPublic = apiKeyConfig.is_public ?? false;
      const ownerEmail = getOwnerEmail(apiKeyConfig);

      let userId: string | null = null;

      if (!isPublic) {
        // For private keys, determine the owner
        if (ownerEmail) {
          userId = userMap.get(ownerEmail) ?? null;
          if (!userId) {
            console.warn(
              `⚠️ Skipping API key "${name}" because user "${ownerEmail}" was not found`,
            );
            continue;
          }
        } else {
          // No user specified, use first user
          const firstUserId = Array.from(userMap.values())[0];
          if (!firstUserId) {
            console.warn(
              `⚠️ Skipping private API key "${name}" because no users are available`,
            );
            continue;
          }
          userId = firstUserId;
        }
      }

      // Check if key already exists
      const whereCondition = userId
        ? and(eq(apiKeysTable.user_id, userId), eq(apiKeysTable.name, name))
        : and(isNull(apiKeysTable.user_id), eq(apiKeysTable.name, name));

      const existing = await db.query.apiKeysTable.findFirst({
        where: whereCondition,
      });

      if (!existing) {
        const key = generateApiKey();
        await db.insert(apiKeysTable).values({
          name,
          key,
          user_id: userId,
          is_active: true,
        });

        const ownerInfo = userId
          ? `for user ${ownerEmail ?? Array.from(userMap.keys())[0]}`
          : "(public)";
        console.log(
          `✓ Created ${isPublic ? "public" : "private"} API key "${name}" ${ownerInfo}: ${maskKey(key)}`,
        );
      } else {
        const ownerInfo = userId
          ? `for user ${ownerEmail ?? Array.from(userMap.keys())[0]}`
          : "(public)";
        console.log(
          `✓ ${isPublic ? "Public" : "Private"} API key "${name}" ${ownerInfo} already exists: ${maskKey(existing.key)}`,
        );
      }
    } catch (err) {
      console.warn(
        `⚠️ Failed to bootstrap API key "${apiKeyConfig.name}":`,
        err,
      );
    }
  }
}

/**
 * Bootstrap MCP servers from configuration array.
 * Optionally creates a per-server namespace + mapping + endpoint when expose=true.
 */
async function bootstrapMcpServers(
  config: EnvConfig,
  userMap: Map<string, string>,
): Promise<void> {
  if (!config.mcpServers || config.mcpServers.length === 0) {
    console.log(
      "ℹ️ No MCP servers configured for bootstrap (BOOTSTRAP_MCP_SERVERS / BOOTSTRAP_MCP_SERVERS_FILE is empty)",
    );
    return;
  }

  console.log(`🔧 Bootstrapping ${config.mcpServers.length} MCP server(s)...`);

  for (const raw of config.mcpServers) {
    try {
      const name = raw.name?.trim();
      if (!name) {
        console.warn("⚠️ Skipping MCP server with empty name");
        continue;
      }

      const resolved = resolveEnvValue(
        raw,
        `mcpServers.${name}`,
      ) as McpServerConfig;
      const type = normalizeMcpServerType(resolved.type);
      const shouldUpdate = resolved.update ?? true;
      const isPublic = resolved.is_public ?? false;
      const ownerEmail = getOwnerEmail(resolved);
      const description = resolved.description ?? null;

      let ownerUserId: string | null = null;
      if (!isPublic) {
        if (ownerEmail) {
          ownerUserId = userMap.get(ownerEmail) ?? null;
          if (!ownerUserId) {
            console.warn(
              `⚠️ Skipping MCP server "${name}" because user "${ownerEmail}" was not found`,
            );
            continue;
          }
        } else {
          const firstUserId = Array.from(userMap.values())[0];
          if (!firstUserId) {
            console.warn(
              `⚠️ Skipping private MCP server "${name}" because no users are available`,
            );
            continue;
          }
          ownerUserId = firstUserId;
        }
      }

      let url = resolved.url ?? null;
      let command = resolved.command ?? null;
      let args = Array.isArray(resolved.args) ? resolved.args : [];
      let env =
        resolved.env && typeof resolved.env === "object" ? resolved.env : {};
      let headers =
        resolved.headers && typeof resolved.headers === "object"
          ? resolved.headers
          : {};
      const bearerToken = resolved.bearerToken ?? null;
      const forwardHeaders =
        resolved.forward_headers && typeof resolved.forward_headers === "object"
          ? resolved.forward_headers
          : {};

      if (
        type === McpServerTypeEnum.enum.SSE ||
        type === McpServerTypeEnum.enum.STREAMABLE_HTTP
      ) {
        if (!url) {
          console.warn(
            `⚠️ Skipping MCP server "${name}" because url is required for type ${type}`,
          );
          continue;
        }
        command = null;
        args = [];
        env = {};
      } else {
        if (!command) {
          console.warn(
            `⚠️ Skipping MCP server "${name}" because command is required for STDIO`,
          );
          continue;
        }
        url = null;
      }

      const whereCondition = ownerUserId
        ? and(
            eq(mcpServersTable.name, name),
            eq(mcpServersTable.user_id, ownerUserId),
          )
        : and(eq(mcpServersTable.name, name), isNull(mcpServersTable.user_id));

      const existing = await db.query.mcpServersTable.findFirst({
        where: whereCondition,
      });

      const values = {
        name,
        description,
        type,
        command,
        args,
        env,
        url,
        headers,
        bearerToken,
        forward_headers: forwardHeaders,
        user_id: ownerUserId,
        error_status: McpServerErrorStatusEnum.enum.NONE,
      };

      let serverUuid: string | undefined;
      if (!existing) {
        const inserted = await db
          .insert(mcpServersTable)
          .values(values)
          .returning({ uuid: mcpServersTable.uuid });
        serverUuid = inserted?.[0]?.uuid;
        const ownerInfo = ownerUserId
          ? `for user ${ownerEmail ?? Array.from(userMap.keys())[0]}`
          : "(public)";
        console.log(
          `✓ Created ${isPublic ? "public" : "private"} MCP server "${name}" (${type}) ${ownerInfo}`,
        );
      } else {
        serverUuid = existing.uuid;
        if (shouldUpdate) {
          await db
            .update(mcpServersTable)
            .set(values)
            .where(eq(mcpServersTable.uuid, existing.uuid));
          console.log(`✓ Updated MCP server "${name}" (${type})`);
        } else {
          console.log(`✓ MCP server "${name}" already exists (no update)`);
        }
      }

      if (!serverUuid) {
        console.warn(`⚠️ MCP server "${name}" has no uuid; skipping expose`);
        continue;
      }

      const expose = resolved.expose ?? false;
      if (!expose) {
        continue;
      }

      const namespaceName = resolved.namespace?.trim() || name;
      const nsWhere = ownerUserId
        ? and(
            eq(namespacesTable.name, namespaceName),
            eq(namespacesTable.user_id, ownerUserId),
          )
        : and(
            eq(namespacesTable.name, namespaceName),
            isNull(namespacesTable.user_id),
          );

      let namespaceUuid: string | undefined;
      const existingNs = await db.query.namespacesTable.findFirst({
        where: nsWhere,
      });

      if (!existingNs) {
        const insertedNs = await db
          .insert(namespacesTable)
          .values({
            name: namespaceName,
            description: `Namespace for ${name}`,
            user_id: ownerUserId,
          })
          .returning({ uuid: namespacesTable.uuid });
        namespaceUuid = insertedNs?.[0]?.uuid;
        if (!namespaceUuid) {
          console.warn(
            `⚠️ Failed to create namespace "${namespaceName}" for MCP server "${name}"`,
          );
          continue;
        }
        console.log(
          `✓ Created namespace "${namespaceName}" for MCP server "${name}"`,
        );
      } else {
        namespaceUuid = existingNs.uuid;
        if (shouldUpdate) {
          await db
            .update(namespacesTable)
            .set({
              description: `Namespace for ${name}`,
              updated_at: new Date(),
              user_id: ownerUserId,
            })
            .where(eq(namespacesTable.uuid, existingNs.uuid));
        }
      }

      await db
        .insert(namespaceServerMappingsTable)
        .values({
          namespace_uuid: namespaceUuid,
          mcp_server_uuid: serverUuid,
          status: McpServerStatusEnum.enum.ACTIVE,
        })
        .onConflictDoUpdate({
          target: [
            namespaceServerMappingsTable.namespace_uuid,
            namespaceServerMappingsTable.mcp_server_uuid,
          ],
          set: { status: McpServerStatusEnum.enum.ACTIVE },
        });

      const toolsPolicy = normalizeToolsConfig(resolved.tools);
      if (toolsPolicy && namespaceUuid) {
        try {
          await saveToolsPolicy(name, toolsPolicy);
          const result = await discoverAndApplyToolsPolicy({
            serverName: name,
            serverUuid,
            namespaceUuid,
            policy: toolsPolicy,
          });
          if (!result.applied) {
            console.warn(
              `⚠️ Tools policy for MCP server "${name}" saved but not fully applied yet (reason=${result.reason ?? "unknown"}); runtime filter will enforce policy for unmapped tools`,
            );
          }
        } catch (err) {
          console.warn(
            `⚠️ Failed to apply tools policy for MCP server "${name}":`,
            err,
          );
        }
      }

      if (resolved.endpoint === false) {
        continue;
      }

      const endpointCfg: McpServerEndpointConfig =
        typeof resolved.endpoint === "object" && resolved.endpoint
          ? resolved.endpoint
          : {};
      const endpointName = endpointCfg.name?.trim() || name;
      const existingEndpoint = await db.query.endpointsTable.findFirst({
        where: eq(endpointsTable.name, endpointName),
      });

      const endpointValues = {
        name: endpointName,
        description: endpointCfg.description ?? `Endpoint for ${name}`,
        namespace_uuid: namespaceUuid,
        enable_api_key_auth: endpointCfg.enable_auth ?? false,
        use_query_param_auth: endpointCfg.enable_auth_query ?? false,
        enable_oauth: endpointCfg.enable_auth_oauth ?? false,
        user_id: endpointCfg.is_public === true ? null : ownerUserId,
        updated_at: new Date(),
      };

      if (!existingEndpoint) {
        await db.insert(endpointsTable).values(endpointValues);
        console.log(
          `✓ Created endpoint "${endpointName}" for MCP server "${name}"`,
        );
      } else if (shouldUpdate) {
        await db
          .update(endpointsTable)
          .set(endpointValues)
          .where(eq(endpointsTable.uuid, existingEndpoint.uuid));
        console.log(
          `✓ Updated endpoint "${endpointName}" for MCP server "${name}"`,
        );
      }
    } catch (err) {
      console.warn(
        `⚠️ Failed to bootstrap MCP server "${raw.name ?? "<unknown>"}":`,
        err,
      );
    }
  }
}

/**
 * Bootstrap namespaces from configuration array.
 */
async function bootstrapNamespaces(
  config: EnvConfig,
  userMap: Map<string, string>,
): Promise<Map<string, string>> {
  const namespaceMap = new Map<string, string>(); // name -> uuid

  if (!config.namespaces || config.namespaces.length === 0) {
    console.log(
      "ℹ️ No namespaces configured for bootstrap (BOOTSTRAP_NAMESPACES is empty)",
    );
    return namespaceMap;
  }

  console.log(`🔧 Bootstrapping ${config.namespaces.length} namespace(s)...`);

  for (const nsConfig of config.namespaces) {
    try {
      const name = nsConfig.name;
      const description = nsConfig.description ?? null;
      const isPublic = nsConfig.is_public ?? false;
      const shouldUpdate = nsConfig.update ?? true;
      const ownerEmail = getOwnerEmail(nsConfig);

      let ownerUserId: string | null = null;

      if (!isPublic) {
        // For private namespaces, determine the owner
        if (ownerEmail) {
          ownerUserId = userMap.get(ownerEmail) ?? null;
          if (!ownerUserId) {
            console.warn(
              `⚠️ Skipping namespace "${name}" because user "${ownerEmail}" was not found`,
            );
            continue;
          }
        } else {
          // No user specified, use first user
          const firstUserId = Array.from(userMap.values())[0];
          if (!firstUserId) {
            console.warn(
              `⚠️ Skipping private namespace "${name}" because no users are available`,
            );
            continue;
          }
          ownerUserId = firstUserId;
        }
      }

      // Look for existing namespace
      const whereCondition = ownerUserId
        ? and(
            eq(namespacesTable.name, name),
            eq(namespacesTable.user_id, ownerUserId),
          )
        : and(eq(namespacesTable.name, name), isNull(namespacesTable.user_id));

      const existing = await db.query.namespacesTable.findFirst({
        where: whereCondition,
      });

      if (!existing) {
        const inserted = await db
          .insert(namespacesTable)
          .values({
            name,
            description,
            user_id: ownerUserId,
          })
          .returning({ uuid: namespacesTable.uuid });

        const uuid = inserted?.[0]?.uuid;
        if (uuid) {
          namespaceMap.set(name, uuid);
          const ownerInfo = ownerUserId
            ? `for user ${ownerEmail ?? Array.from(userMap.keys())[0]}`
            : "(public)";
          console.log(
            `✓ Created ${isPublic ? "public" : "private"} namespace "${name}" ${ownerInfo}`,
          );
        } else {
          console.warn(`⚠️ Namespace insert for "${name}" did not return uuid`);
        }
      } else {
        namespaceMap.set(name, existing.uuid);

        if (shouldUpdate) {
          await db
            .update(namespacesTable)
            .set({
              description: description ?? existing.description,
              updated_at: new Date(),
              user_id: ownerUserId,
            })
            .where(eq(namespacesTable.uuid, existing.uuid));

          console.log(`✓ Updated namespace "${name}"`);
        } else {
          console.log(`✓ Namespace "${name}" already exists (no update)`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ Failed to bootstrap namespace "${nsConfig.name}":`, err);
    }
  }

  return namespaceMap;
}

/**
 * Bootstrap endpoints from configuration array.
 */
async function bootstrapEndpoints(
  config: EnvConfig,
  namespaceMap: Map<string, string>,
  userMap: Map<string, string>,
): Promise<void> {
  if (!config.endpoints || config.endpoints.length === 0) {
    console.log(
      "ℹ️ No endpoints configured for bootstrap (BOOTSTRAP_ENDPOINTS is empty)",
    );
    return;
  }

  console.log(`🔧 Bootstrapping ${config.endpoints.length} endpoint(s)...`);

  for (const epConfig of config.endpoints) {
    try {
      const name = epConfig.name;
      const description = epConfig.description ?? null;
      const enableAuth = epConfig.enable_auth ?? true;
      const enableAuthQuery = epConfig.enable_auth_query ?? false;
      const enableAuthOauth = epConfig.enable_auth_oauth ?? false;
      const isPublic = epConfig.is_public ?? true;
      const shouldUpdate = epConfig.update ?? true;
      const ownerEmail = getOwnerEmail(epConfig);

      let ownerUserId: string | null = null;

      if (!isPublic) {
        // For private endpoints, determine the owner
        if (ownerEmail) {
          ownerUserId = userMap.get(ownerEmail) ?? null;
          if (!ownerUserId) {
            console.warn(
              `⚠️ Skipping endpoint "${name}" because user "${ownerEmail}" was not found`,
            );
            continue;
          }
        } else {
          // No user specified, use first user
          const firstUserId = Array.from(userMap.values())[0];
          if (!firstUserId) {
            console.warn(
              `⚠️ Skipping private endpoint "${name}" because no users are available`,
            );
            continue;
          }
          ownerUserId = firstUserId;
        }
      }

      // Find the namespace UUID
      let namespaceUuid: string | undefined;
      let namespaceName: string | undefined;

      if (epConfig.namespace) {
        // Specific namespace requested
        namespaceUuid = namespaceMap.get(epConfig.namespace);
        namespaceName = epConfig.namespace;

        if (!namespaceUuid) {
          console.warn(
            `⚠️ Skipping endpoint "${name}" because specified namespace "${epConfig.namespace}" was not found. Available namespaces: ${Array.from(namespaceMap.keys()).join(", ")}`,
          );
          continue;
        }
      } else {
        // No namespace specified, use first available
        if (namespaceMap.size > 0) {
          namespaceUuid = Array.from(namespaceMap.values())[0];
          namespaceName = Array.from(namespaceMap.keys())[0];
        }
      }

      if (!namespaceUuid) {
        console.warn(
          `⚠️ Skipping endpoint "${name}" because no namespace is available. Bootstrap at least one namespace first.`,
        );
        continue;
      }

      // Look for existing endpoint
      const existing = await db.query.endpointsTable.findFirst({
        where: eq(endpointsTable.name, name),
      });

      const values = {
        name,
        description,
        namespace_uuid: namespaceUuid,
        enable_api_key_auth: enableAuth,
        use_query_param_auth: enableAuthQuery,
        enable_oauth: enableAuthOauth,
        user_id: ownerUserId,
        updated_at: new Date(),
      };

      if (!existing) {
        await db.insert(endpointsTable).values(values);
        const ownerInfo = ownerUserId
          ? `for user ${ownerEmail ?? Array.from(userMap.keys())[0]}`
          : "(public)";
        const namespaceInfo = namespaceName
          ? ` in namespace "${namespaceName}"`
          : "";
        console.log(
          `✓ Created ${isPublic ? "public" : "private"} endpoint "${name}" ${ownerInfo}${namespaceInfo}`,
        );
      } else {
        if (shouldUpdate) {
          await db
            .update(endpointsTable)
            .set(values)
            .where(eq(endpointsTable.uuid, existing.uuid));
          const namespaceInfo = namespaceName
            ? ` in namespace "${namespaceName}"`
            : "";
          console.log(`✓ Updated endpoint "${name}"${namespaceInfo}`);
        } else {
          console.log(`✓ Endpoint "${name}" already exists (no update)`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ Failed to bootstrap endpoint "${epConfig.name}":`, err);
    }
  }
}

function validateConfig(config: EnvConfig): void {
  if (
    config.disableUiRegistration &&
    config.disableSsoRegistration &&
    config.users.length === 0
  ) {
    console.warn(
      "⚠️ Both UI and SSO registration are disabled, but no users are configured. This may lock you out.",
    );
  }

  if (config.recreateDefaultUser && config.users.length === 0) {
    console.warn(
      "⚠️ BOOTSTRAP_RECREATE_USER=true but no users are configured; recreation cannot run.",
    );
  }

  // Validate users
  for (const user of config.users) {
    if (!user.email || user.email.trim() === "") {
      console.warn("⚠️ User configuration is missing 'email' field");
    }
    if (!user.password || user.password.trim() === "") {
      console.warn(`⚠️ User ${user.email} is missing 'password' field`);
    }
    if (user.password && user.password.length < 8) {
      console.warn(
        `⚠️ Password for ${user.email} is less than 8 characters. Consider using a stronger password.`,
      );
    }
  }

  if (config.recreateDefaultUser && !config.preserveApiKeysOnRecreate) {
    console.warn(
      "⚠️ BOOTSTRAP_RECREATE_USER=true and BOOTSTRAP_PRESERVE_API_KEYS=false",
    );
    console.warn("     This will delete all API keys for the users!");
  }

  if (config.deleteOtherUsers && config.users.length === 0) {
    console.warn(
      "⚠️ BOOTSTRAP_DELETE_OTHER_USERS=true without any users configured",
    );
    console.warn("     This could lock you out of the system!");
  }

  // Validate API keys configuration
  for (const apiKey of config.apiKeys) {
    if (!apiKey.name || apiKey.name.trim() === "") {
      console.warn("⚠️ API key configuration is missing 'name' field");
    }
    const ownerEmail = getOwnerEmail(apiKey);
    if (!apiKey.is_public && ownerEmail && config.users.length === 0) {
      console.warn(
        `⚠️ API key "${apiKey.name}" references user "${ownerEmail}" but no users are configured`,
      );
    }
  }

  // Validate MCP servers configuration
  for (const server of config.mcpServers) {
    if (!server.name || server.name.trim() === "") {
      console.warn("⚠️ MCP server configuration is missing 'name' field");
      continue;
    }
    const type = normalizeMcpServerType(server.type);
    if (
      (type === McpServerTypeEnum.enum.SSE ||
        type === McpServerTypeEnum.enum.STREAMABLE_HTTP) &&
      (!server.url || server.url.trim() === "")
    ) {
      console.warn(
        `⚠️ MCP server "${server.name}" type ${type} requires a 'url' field`,
      );
    }
    if (type === McpServerTypeEnum.enum.STDIO && !server.command) {
      console.warn(
        `⚠️ MCP server "${server.name}" type STDIO requires a 'command' field`,
      );
    }
    const ownerEmail = getOwnerEmail(server);
    if (!server.is_public && ownerEmail && config.users.length === 0) {
      console.warn(
        `⚠️ MCP server "${server.name}" references user "${ownerEmail}" but no users are configured`,
      );
    }
  }

  // Validate namespaces configuration
  for (const ns of config.namespaces) {
    if (!ns.name || ns.name.trim() === "") {
      console.warn("⚠️ Namespace configuration is missing 'name' field");
    }
    const ownerEmail = getOwnerEmail(ns);
    if (!ns.is_public && ownerEmail && config.users.length === 0) {
      console.warn(
        `⚠️ Namespace "${ns.name}" references user "${ownerEmail}" but no users are configured`,
      );
    }
  }

  // Validate endpoints configuration
  for (const ep of config.endpoints) {
    if (!ep.name || ep.name.trim() === "") {
      console.warn("⚠️ Endpoint configuration is missing 'name' field");
    }
    const ownerEmail = getOwnerEmail(ep);
    if (!ep.is_public && ownerEmail && config.users.length === 0) {
      console.warn(
        `⚠️ Endpoint "${ep.name}" references user "${ownerEmail}" but no users are configured`,
      );
    }
  }

  if (config.endpoints.length > 0 && config.namespaces.length === 0) {
    console.warn("⚠️ Endpoints are configured but no namespaces are defined.");
    console.warn(
      "     Endpoints require at least one namespace to be created!",
    );
  }
}

export async function initializeEnvironmentConfiguration(): Promise<void> {
  console.log("🚀 Initializing environment-based configuration...");
  const config = parseEnvConfig();

  // Log configuration summary for debugging
  if (process.env.BOOTSTRAP_DEBUG === "true") {
    console.log("📋 Bootstrap Configuration:");
    console.log(`   Users: ${config.users.length} configured`);
    console.log(`   API Keys: ${config.apiKeys.length} configured`);
    console.log(`   MCP Servers: ${config.mcpServers.length} configured`);
    console.log(`   Namespaces: ${config.namespaces.length} configured`);
    console.log(`   Endpoints: ${config.endpoints.length} configured`);
    console.log(`   Recreate User: ${config.recreateDefaultUser}`);
    console.log(`   First Run Only: ${config.bootstrapOnlyOnFirstRun}`);
    console.log(`   Delete Others: ${config.deleteOtherUsers}`);
  }

  validateConfig(config);

  // Registration controls (applied every run)
  console.log("🔧 Setting registration controls...");
  try {
    await upsertConfig(
      ConfigKeyEnum.enum.DISABLE_SIGNUP,
      config.disableUiRegistration.toString(),
      "Whether new user signup is disabled",
    );
  } catch (err) {
    console.warn("⚠️ Failed to set UI registration control:", err);
  }

  try {
    await upsertConfig(
      ConfigKeyEnum.enum.DISABLE_SSO_SIGNUP,
      config.disableSsoRegistration.toString(),
      "Whether new user signup via SSO/OAuth is disabled",
    );
  } catch (err) {
    console.warn("⚠️ Failed to set SSO registration control:", err);
  }

  console.log(
    `✓ Registration controls set: UI=${!config.disableUiRegistration}, SSO=${!config.disableSsoRegistration}`,
  );

  // One-time bootstrap guard
  const skipBootstrap = await shouldSkipBootstrap(config);
  if (skipBootstrap) {
    console.log("✅ Environment-based configuration initialized (guarded)");
    return;
  }

  // Bootstrap all users
  let userMap: Map<string, string>;
  try {
    userMap = await bootstrapUsers(config);
  } catch (err) {
    console.warn("⚠️ Users bootstrap failed:", err);
    userMap = new Map();
  }

  // Delete other users after bootstrapping configured users
  try {
    const bootstrappedEmails = Array.from(userMap.keys());
    await maybeDeleteOtherUsers(config, bootstrappedEmails);
  } catch (err) {
    console.warn("⚠️ User cleanup step failed:", err);
  }

  // Bootstrap API keys
  try {
    await bootstrapApiKeys(config, userMap);
  } catch (err) {
    console.warn("⚠️ API keys bootstrap failed:", err);
  }

  // Bootstrap MCP servers (optionally creates per-server namespace/endpoint)
  try {
    await bootstrapMcpServers(config, userMap);
  } catch (err) {
    console.warn("⚠️ MCP servers bootstrap failed:", err);
  }

  // Bootstrap namespaces and collect UUID mappings
  let namespaceMap: Map<string, string>;
  try {
    namespaceMap = await bootstrapNamespaces(config, userMap);
  } catch (err) {
    console.warn("⚠️ Namespaces bootstrap failed:", err);
    namespaceMap = new Map();
  }

  // Bootstrap endpoints
  try {
    await bootstrapEndpoints(config, namespaceMap, userMap);
  } catch (err) {
    console.warn("⚠️ Endpoints bootstrap failed:", err);
  }

  // Mark one-time bootstrap complete
  if (config.bootstrapOnlyOnFirstRun) {
    if (userMap.size > 0 || namespaceMap.size > 0) {
      await markBootstrapComplete();
    }
  }

  console.log("✅ Environment-based configuration initialized successfully");
}
