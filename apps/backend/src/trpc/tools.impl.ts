import {
  CreateToolRequestSchema,
  CreateToolResponseSchema,
  GetToolCatalogResponseSchema,
  GetToolsByMcpServerUuidRequestSchema,
  GetToolsByMcpServerUuidResponseSchema,
  SetCatalogServerStatusRequestSchema,
  SetCatalogStatusResponseSchema,
  SetCatalogToolsStatusRequestSchema,
  ToolCatalogStatus,
  ToolStatus,
} from "@repo/zod-types";
import { z } from "zod";

import logger from "@/utils/logger";

import {
  mcpServersRepository,
  namespaceMappingsRepository,
  namespacesRepository,
  toolsRepository,
} from "../db/repositories";
import { ToolsSerializer } from "../db/serializers";
import {
  loadToolsPolicy,
  McpServerToolsConfig,
  resolveEffectiveToolStatus,
} from "../lib/bootstrap-tools-policy";
import { clearFilterCache } from "../lib/metamcp/metamcp-middleware/filter-tools.functional";
import { metaMcpServerPool } from "../lib/metamcp/metamcp-server-pool";
import { toolsSyncCache } from "../lib/metamcp/tools-sync-cache";

/**
 * Collapse the per-namespace statuses of one server or tool into a single
 * catalog status. Namespaces that disagree report MIXED.
 */
function aggregateStatus(statuses: ToolStatus[]): ToolCatalogStatus {
  if (statuses.length === 0) {
    return "UNAVAILABLE";
  }
  if (statuses.every((status) => status === "ACTIVE")) {
    return "ACTIVE";
  }
  if (statuses.every((status) => status === "INACTIVE")) {
    return "INACTIVE";
  }
  return "MIXED";
}

/**
 * Namespaces the user is allowed to change, matching the per-namespace rule
 * used elsewhere: their own namespaces plus public ones.
 */
async function getWritableNamespaceUuids(userId: string): Promise<string[]> {
  const namespaces = await namespacesRepository.findAllAccessibleToUser(userId);
  return namespaces.map((namespace) => namespace.uuid);
}

function invalidateNamespaces(namespaceUuids: string[], reason: string): void {
  for (const namespaceUuid of namespaceUuids) {
    clearFilterCache(namespaceUuid);
  }

  Promise.all(
    namespaceUuids.map((namespaceUuid) =>
      metaMcpServerPool.invalidateIdleServer(namespaceUuid),
    ),
  ).catch((error) => {
    logger.error(`Error invalidating idle servers after ${reason}:`, error);
  });

  metaMcpServerPool.invalidateOpenApiSessions(namespaceUuids).catch((error) => {
    logger.error(`Error invalidating OpenAPI sessions after ${reason}:`, error);
  });
}

export const toolsImplementations = {
  getByMcpServerUuid: async (
    input: z.infer<typeof GetToolsByMcpServerUuidRequestSchema>,
  ): Promise<z.infer<typeof GetToolsByMcpServerUuidResponseSchema>> => {
    try {
      const tools = await toolsRepository.findByMcpServerUuid(
        input.mcpServerUuid,
      );

      return {
        success: true as const,
        data: ToolsSerializer.serializeToolList(tools),
        message: "Tools retrieved successfully",
      };
    } catch (error) {
      logger.error("Error fetching tools by MCP server UUID:", error);
      return {
        success: false as const,
        data: [],
        message: "Failed to fetch tools",
      };
    }
  },

  /**
   * Flat catalog of every MCP server the user can see, each with its tools and
   * a status aggregated over all namespaces the user can write to.
   */
  getCatalog: async (
    userId: string,
  ): Promise<z.infer<typeof GetToolCatalogResponseSchema>> => {
    try {
      const [servers, namespaceUuids] = await Promise.all([
        mcpServersRepository.findAllAccessibleToUser(userId),
        getWritableNamespaceUuids(userId),
      ]);

      const [tools, serverMappings, toolMappings] = await Promise.all([
        toolsRepository.findByMcpServerUuids(
          servers.map((server) => server.uuid),
        ),
        namespaceMappingsRepository.findServerMappingsByNamespaces(
          namespaceUuids,
        ),
        namespaceMappingsRepository.findToolMappingsByNamespaces(
          namespaceUuids,
        ),
      ]);

      // serverUuid -> namespaces mapping that server, with its status there
      const serverNamespaces = new Map<string, Map<string, ToolStatus>>();
      for (const mapping of serverMappings) {
        const byNamespace =
          serverNamespaces.get(mapping.mcp_server_uuid) ??
          new Map<string, ToolStatus>();
        byNamespace.set(mapping.namespace_uuid, mapping.status);
        serverNamespaces.set(mapping.mcp_server_uuid, byNamespace);
      }

      // toolUuid -> status per namespace
      const toolNamespaces = new Map<string, Map<string, ToolStatus>>();
      for (const mapping of toolMappings) {
        const byNamespace =
          toolNamespaces.get(mapping.tool_uuid) ??
          new Map<string, ToolStatus>();
        byNamespace.set(mapping.namespace_uuid, mapping.status);
        toolNamespaces.set(mapping.tool_uuid, byNamespace);
      }

      const toolsByServer = new Map<string, typeof tools>();
      for (const tool of tools) {
        const list = toolsByServer.get(tool.mcp_server_uuid) ?? [];
        list.push(tool);
        toolsByServer.set(tool.mcp_server_uuid, list);
      }

      // Unmapped tools fall back to the bootstrap policy, same as the runtime
      // filter, so the catalog shows what clients actually get.
      const policyCache = new Map<string, McpServerToolsConfig | null>();
      const getPolicy = async (serverName: string) => {
        if (!policyCache.has(serverName)) {
          policyCache.set(serverName, await loadToolsPolicy(serverName));
        }
        return policyCache.get(serverName) ?? null;
      };

      const data = [];
      for (const server of servers) {
        const namespacesForServer = serverNamespaces.get(server.uuid);
        const serverNamespaceUuids = namespacesForServer
          ? [...namespacesForServer.keys()]
          : [];

        const catalogTools = [];
        for (const tool of toolsByServer.get(server.uuid) ?? []) {
          const mappedStatuses = toolNamespaces.get(tool.uuid);
          const statuses: ToolStatus[] = [];

          for (const namespaceUuid of serverNamespaceUuids) {
            const mapped = mappedStatuses?.get(namespaceUuid) ?? null;
            if (mapped) {
              statuses.push(mapped);
              continue;
            }

            const policy = await getPolicy(server.name);
            statuses.push(
              resolveEffectiveToolStatus(tool.name, null, policy) ?? "ACTIVE",
            );
          }

          catalogTools.push({
            uuid: tool.uuid,
            name: tool.name,
            description: tool.description,
            status: aggregateStatus(statuses),
          });
        }

        data.push({
          uuid: server.uuid,
          name: server.name,
          description: server.description,
          type: server.type,
          status: aggregateStatus(
            namespacesForServer ? [...namespacesForServer.values()] : [],
          ),
          namespaceCount: serverNamespaceUuids.length,
          tools: catalogTools,
        });
      }

      data.sort((a, b) => a.name.localeCompare(b.name));

      return {
        success: true as const,
        data,
        message: "Tool catalog retrieved successfully",
      };
    } catch (error) {
      logger.error("Error building tool catalog:", error);
      return {
        success: false as const,
        data: [],
        message: "Failed to build tool catalog",
      };
    }
  },

  /**
   * Enable or disable one MCP server in every namespace the user can write to.
   * Tool statuses are left untouched.
   */
  setCatalogServerStatus: async (
    input: z.infer<typeof SetCatalogServerStatusRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof SetCatalogStatusResponseSchema>> => {
    try {
      const server = await mcpServersRepository.findByUuid(input.serverUuid);

      if (!server) {
        return { success: false as const, message: "MCP server not found" };
      }

      if (server.user_id && server.user_id !== userId) {
        return {
          success: false as const,
          message:
            "Access denied: You can only change MCP servers you own or public ones",
        };
      }

      const namespaceUuids = await getWritableNamespaceUuids(userId);
      const updated =
        await namespaceMappingsRepository.setServerStatusAcrossNamespaces({
          serverUuid: input.serverUuid,
          namespaceUuids,
          status: input.status,
        });

      if (updated.length === 0) {
        return {
          success: false as const,
          message:
            "This MCP server is not part of any namespace yet, so there is nothing to turn on or off",
        };
      }

      invalidateNamespaces(
        updated.map((mapping) => mapping.namespace_uuid),
        "catalog server status update",
      );

      return {
        success: true as const,
        message: "MCP server status updated",
        updatedCount: updated.length,
      };
    } catch (error) {
      logger.error("Error updating catalog server status:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  /**
   * Enable or disable tools in every namespace that maps their MCP server.
   * Handles both a single switch and a group's "All on" / "All off".
   */
  setCatalogToolsStatus: async (
    input: z.infer<typeof SetCatalogToolsStatusRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof SetCatalogStatusResponseSchema>> => {
    try {
      const tools = await toolsRepository.findByUuids(
        input.items.map((item) => item.toolUuid),
      );

      if (tools.length === 0) {
        return { success: false as const, message: "Tools not found" };
      }

      const accessibleServers =
        await mcpServersRepository.findAllAccessibleToUser(userId);
      const accessibleServerUuids = new Set(
        accessibleServers.map((server) => server.uuid),
      );

      const toolsByUuid = new Map(tools.map((tool) => [tool.uuid, tool]));
      const namespaceUuids = await getWritableNamespaceUuids(userId);
      const serverMappings =
        await namespaceMappingsRepository.findServerMappingsByNamespaces(
          namespaceUuids,
        );

      const namespacesByServer = new Map<string, string[]>();
      for (const mapping of serverMappings) {
        const list = namespacesByServer.get(mapping.mcp_server_uuid) ?? [];
        list.push(mapping.namespace_uuid);
        namespacesByServer.set(mapping.mcp_server_uuid, list);
      }

      const entries = [];
      const touchedNamespaces = new Set<string>();
      const updatedTools = new Set<string>();

      for (const item of input.items) {
        const tool = toolsByUuid.get(item.toolUuid);
        if (!tool || !accessibleServerUuids.has(tool.mcp_server_uuid)) {
          continue;
        }

        for (const namespaceUuid of namespacesByServer.get(
          tool.mcp_server_uuid,
        ) ?? []) {
          entries.push({
            namespaceUuid,
            toolUuid: tool.uuid,
            serverUuid: tool.mcp_server_uuid,
            status: item.status,
          });
          touchedNamespaces.add(namespaceUuid);
          updatedTools.add(tool.uuid);
        }
      }

      if (entries.length === 0) {
        return {
          success: false as const,
          message:
            "These tools belong to an MCP server that is not part of any namespace yet",
        };
      }

      await namespaceMappingsRepository.setToolsStatusAcrossNamespaces({
        entries,
      });

      invalidateNamespaces(
        [...touchedNamespaces],
        "catalog tool status update",
      );

      return {
        success: true as const,
        message: "Tool status updated",
        updatedCount: updatedTools.size,
      };
    } catch (error) {
      logger.error("Error updating catalog tool status:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  create: async (
    input: z.infer<typeof CreateToolRequestSchema>,
  ): Promise<z.infer<typeof CreateToolResponseSchema>> => {
    try {
      if (!input.tools || input.tools.length === 0) {
        return {
          success: true as const,
          count: 0,
          message: "No tools to save",
        };
      }

      const results = await toolsRepository.bulkUpsert({
        tools: input.tools,
        mcpServerUuid: input.mcpServerUuid,
      });

      return {
        success: true as const,
        count: results.length,
        message: `Successfully saved ${results.length} tools`,
      };
    } catch (error) {
      logger.error("Error saving tools to database:", error);
      return {
        success: false as const,
        count: 0,
        error: error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  /**
   * Smart sync with hash-check and cleanup
   * Only syncs if tools have actually changed (performance optimized)
   */
  sync: async (
    input: z.infer<typeof CreateToolRequestSchema>,
  ): Promise<z.infer<typeof CreateToolResponseSchema>> => {
    try {
      if (!input.tools || input.tools.length === 0) {
        return {
          success: true as const,
          count: 0,
          message: "No tools to sync",
        };
      }

      // Check if tools changed using hash
      const toolNames = input.tools.map((tool) => tool.name);
      const hasChanged = toolsSyncCache.hasChanged(
        input.mcpServerUuid,
        toolNames,
      );

      if (hasChanged) {
        // Update cache
        toolsSyncCache.update(input.mcpServerUuid, toolNames);

        // Perform sync with cleanup
        const { upserted, deleted } = await toolsRepository.syncTools({
          tools: input.tools,
          mcpServerUuid: input.mcpServerUuid,
        });

        const message =
          deleted.length > 0
            ? `Successfully synced ${upserted.length} tools (removed ${deleted.length} obsolete)`
            : `Successfully synced ${upserted.length} tools`;

        return {
          success: true as const,
          count: upserted.length,
          message,
        };
      } else {
        return {
          success: true as const,
          count: input.tools.length,
          message: "Tools unchanged, skipped sync",
        };
      }
    } catch (error) {
      console.error("Error syncing tools to database:", error);
      return {
        success: false as const,
        count: 0,
        error: error instanceof Error ? error.message : "Internal server error",
      };
    }
  },
};
