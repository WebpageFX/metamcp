import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { eq } from "drizzle-orm";

import { db } from "../db";
import {
  namespaceMappingsRepository,
  toolsRepository,
} from "../db/repositories";
import { configTable, mcpServersTable } from "../db/schema";
import { connectMetaMcpClient } from "./metamcp/client";
import { convertDbServerToParams } from "./metamcp/utils";

/**
 * Bootstrap / declarative tool visibility for an MCP server's exposed namespace.
 *
 * Resolution order for each discovered tool name:
 * 1. `disable` list → INACTIVE
 * 2. `enable` list → ACTIVE
 * 3. `default` (`active` | `inactive`, default `active`)
 */
export type McpServerToolsConfig = {
  /** Status for tools not listed in enable/disable. Default: active */
  default?: "active" | "inactive";
  /** Tool names forced ACTIVE (overrides default) */
  enable?: string[];
  /** Tool names forced INACTIVE (overrides enable and default) */
  disable?: string[];
};

export type ToolStatus = "ACTIVE" | "INACTIVE";

const POLICY_KEY_PREFIX = "BOOTSTRAP_MCP_TOOLS_POLICY:";

export function toolsPolicyConfigKey(serverName: string): string {
  return `${POLICY_KEY_PREFIX}${serverName}`;
}

export function isDefaultInactivePolicy(
  policy: McpServerToolsConfig,
): boolean {
  return (policy.default ?? "active") === "inactive";
}

export function normalizeToolsConfig(
  raw: unknown,
): McpServerToolsConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const enable = normalizeNameList(obj.enable ?? obj.enabled);
  const disable = normalizeNameList(obj.disable ?? obj.disabled);

  let defaultStatus: "active" | "inactive" | undefined;
  if (typeof obj.default === "string") {
    const d = obj.default.trim().toLowerCase();
    if (d === "active" || d === "inactive") {
      defaultStatus = d;
    } else {
      console.warn(
        `⚠️ tools.default must be "active" or "inactive", got "${obj.default}"`,
      );
    }
  }

  if (!defaultStatus && enable.length === 0 && disable.length === 0) {
    return null;
  }

  return {
    ...(defaultStatus ? { default: defaultStatus } : {}),
    ...(enable.length > 0 ? { enable } : {}),
    ...(disable.length > 0 ? { disable } : {}),
  };
}

function normalizeNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (name) out.push(name);
  }
  return out;
}

export function resolveToolStatus(
  toolName: string,
  policy: McpServerToolsConfig,
): ToolStatus {
  const disable = new Set(policy.disable ?? []);
  const enable = new Set(policy.enable ?? []);

  if (disable.has(toolName)) {
    return "INACTIVE";
  }
  if (enable.has(toolName)) {
    return "ACTIVE";
  }
  return (policy.default ?? "active") === "inactive" ? "INACTIVE" : "ACTIVE";
}

/**
 * Prefer an explicit namespace mapping; otherwise apply bootstrap policy.
 * Returns null only when there is no mapping and no policy (legacy fail-open).
 */
export function resolveEffectiveToolStatus(
  toolName: string,
  mappingStatus: ToolStatus | null,
  policy: McpServerToolsConfig | null,
): ToolStatus | null {
  if (mappingStatus === "ACTIVE" || mappingStatus === "INACTIVE") {
    return mappingStatus;
  }
  if (!policy) {
    return null;
  }
  return resolveToolStatus(toolName, policy);
}

export async function saveToolsPolicy(
  serverName: string,
  policy: McpServerToolsConfig,
): Promise<void> {
  const key = toolsPolicyConfigKey(serverName);
  await db
    .insert(configTable)
    .values({
      id: key,
      value: JSON.stringify(policy),
      description: `Bootstrap tools enable/disable policy for MCP server "${serverName}"`,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [configTable.id],
      set: {
        value: JSON.stringify(policy),
        description: `Bootstrap tools enable/disable policy for MCP server "${serverName}"`,
        updated_at: new Date(),
      },
    });
}

export async function loadToolsPolicy(
  serverName: string,
): Promise<McpServerToolsConfig | null> {
  const row = await db.query.configTable.findFirst({
    where: eq(configTable.id, toolsPolicyConfigKey(serverName)),
  });
  if (!row?.value) return null;
  try {
    return normalizeToolsConfig(JSON.parse(row.value));
  } catch {
    console.warn(
      `⚠️ Failed to parse tools policy for MCP server "${serverName}"`,
    );
    return null;
  }
}

async function clearNamespaceFilterCache(namespaceUuid: string): Promise<void> {
  // Dynamic import avoids a circular dependency with filter-tools.functional
  // (that module loads policies for unmapped-tool fail-closed).
  const { clearFilterCache } = await import(
    "./metamcp/metamcp-middleware/filter-tools.functional"
  );
  clearFilterCache(namespaceUuid);
}

export async function applyToolsPolicyMappings(input: {
  namespaceUuid: string;
  serverUuid: string;
  tools: Array<{ uuid: string; name: string }>;
  policy: McpServerToolsConfig;
}): Promise<{ active: number; inactive: number }> {
  let active = 0;
  let inactive = 0;

  const toolMappings = input.tools.map((tool) => {
    const status = resolveToolStatus(tool.name, input.policy);
    if (status === "ACTIVE") active += 1;
    else inactive += 1;
    return {
      toolUuid: tool.uuid,
      serverUuid: input.serverUuid,
      status,
    };
  });

  if (toolMappings.length > 0) {
    await namespaceMappingsRepository.bulkUpsertNamespaceToolMappings({
      namespaceUuid: input.namespaceUuid,
      toolMappings,
    });
  }

  await clearNamespaceFilterCache(input.namespaceUuid);
  return { active, inactive };
}

/**
 * Re-apply policy to tools already stored for this server (e.g. discovery failed
 * but a previous run populated the tools table).
 */
export async function applyToolsPolicyToStoredTools(input: {
  serverName: string;
  serverUuid: string;
  namespaceUuid: string;
  policy: McpServerToolsConfig;
}): Promise<{ active: number; inactive: number; tools: number }> {
  const existing = await toolsRepository.findByMcpServerUuid(input.serverUuid);
  if (existing.length === 0) {
    return { active: 0, inactive: 0, tools: 0 };
  }

  const counts = await applyToolsPolicyMappings({
    namespaceUuid: input.namespaceUuid,
    serverUuid: input.serverUuid,
    tools: existing.map((t) => ({ uuid: t.uuid, name: t.name })),
    policy: input.policy,
  });

  return { ...counts, tools: existing.length };
}

export type DiscoverToolsPolicyResult = {
  applied: boolean;
  reason?: string;
};

/**
 * Connect to the upstream MCP server, list tools, upsert them, and apply
 * namespace ACTIVE/INACTIVE mappings from the tools policy.
 *
 * On discovery failure with `default: inactive`, still applies policy to any
 * tools already in the DB and relies on the list/call filter to hide unmapped
 * tools via the persisted policy (fail-closed).
 */
export async function discoverAndApplyToolsPolicy(input: {
  serverName: string;
  serverUuid: string;
  namespaceUuid: string;
  policy: McpServerToolsConfig;
}): Promise<DiscoverToolsPolicyResult> {
  const failClosed = isDefaultInactivePolicy(input.policy);

  const server = await db.query.mcpServersTable.findFirst({
    where: eq(mcpServersTable.uuid, input.serverUuid),
  });
  if (!server) {
    console.warn(
      `⚠️ Cannot apply tools policy for "${input.serverName}": server row missing`,
    );
    return { applied: false, reason: "server_missing" };
  }

  const params = await convertDbServerToParams(server);
  if (!params) {
    console.warn(
      `⚠️ Cannot apply tools policy for "${input.serverName}": failed to build connection params`,
    );
    await hardenAfterDiscoveryFailure(input, failClosed, "params");
    return { applied: false, reason: "params" };
  }

  const connected = await connectMetaMcpClient(params);
  if (!connected) {
    console.warn(
      `⚠️ Cannot apply tools policy for "${input.serverName}": upstream connect failed (policy saved; filter fail-closed until tools refresh)`,
    );
    await hardenAfterDiscoveryFailure(input, failClosed, "connect");
    return { applied: false, reason: "connect" };
  }

  try {
    const result = await connected.client.request(
      { method: "tools/list" },
      ListToolsResultSchema,
    );
    const listed = result.tools ?? [];
    if (listed.length === 0) {
      console.log(
        `ℹ️ MCP server "${input.serverName}" returned no tools; nothing to map`,
      );
      // No tools exposed upstream — treat as successfully applied (nothing open).
      return { applied: true };
    }

    const upserted = await toolsRepository.bulkUpsert({
      mcpServerUuid: input.serverUuid,
      tools: listed.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        inputSchema: (tool.inputSchema || {
          type: "object",
        }) as Record<string, unknown>,
      })),
    });

    const counts = await applyToolsPolicyMappings({
      namespaceUuid: input.namespaceUuid,
      serverUuid: input.serverUuid,
      tools: upserted.map((t) => ({ uuid: t.uuid, name: t.name })),
      policy: input.policy,
    });

    console.log(
      `✓ Applied tools policy for "${input.serverName}": ${counts.active} active, ${counts.inactive} inactive (${upserted.length} tools)`,
    );
    return { applied: true };
  } catch (err) {
    console.warn(
      `⚠️ Failed to list/apply tools for "${input.serverName}" (policy saved; filter fail-closed until tools refresh):`,
      err,
    );
    await hardenAfterDiscoveryFailure(input, failClosed, "list");
    return { applied: false, reason: "list" };
  } finally {
    try {
      await connected.cleanup();
    } catch {
      // ignore cleanup errors
    }
  }
}

async function hardenAfterDiscoveryFailure(
  input: {
    serverName: string;
    serverUuid: string;
    namespaceUuid: string;
    policy: McpServerToolsConfig;
  },
  failClosed: boolean,
  stage: string,
): Promise<void> {
  try {
    const stored = await applyToolsPolicyToStoredTools(input);
    if (stored.tools > 0) {
      console.warn(
        `⚠️ Re-applied tools policy for "${input.serverName}" to ${stored.tools} stored tool(s) after ${stage} failure (${stored.active} active, ${stored.inactive} inactive)`,
      );
    } else if (failClosed) {
      console.warn(
        `⚠️ Tools policy for "${input.serverName}" is default=inactive but discovery failed at ${stage} with no stored tools yet. Unmapped tools will stay hidden by the runtime filter until a successful tools refresh.`,
      );
    }
  } catch (err) {
    console.warn(
      `⚠️ Failed to harden stored tools for "${input.serverName}" after ${stage} failure:`,
      err,
    );
  }
}
