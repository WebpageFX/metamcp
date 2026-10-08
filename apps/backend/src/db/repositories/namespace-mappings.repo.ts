import {
  NamespaceServerStatusUpdate,
  NamespaceToolOverridesUpdate,
  NamespaceToolStatusUpdate,
} from "@repo/zod-types";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../index";
import {
  namespaceServerMappingsTable,
  namespaceToolMappingsTable,
} from "../schema";

export class NamespaceMappingsRepository {
  async updateServerStatus(input: NamespaceServerStatusUpdate) {
    const [updatedMapping] = await db
      .update(namespaceServerMappingsTable)
      .set({
        status: input.status,
      })
      .where(
        and(
          eq(namespaceServerMappingsTable.namespace_uuid, input.namespaceUuid),
          eq(namespaceServerMappingsTable.mcp_server_uuid, input.serverUuid),
        ),
      )
      .returning();

    return updatedMapping;
  }

  async updateToolStatus(input: NamespaceToolStatusUpdate) {
    const [updatedMapping] = await db
      .update(namespaceToolMappingsTable)
      .set({
        status: input.status,
      })
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, input.namespaceUuid),
          eq(namespaceToolMappingsTable.tool_uuid, input.toolUuid),
          eq(namespaceToolMappingsTable.mcp_server_uuid, input.serverUuid),
        ),
      )
      .returning();

    return updatedMapping;
  }

  async updateToolOverrides(input: NamespaceToolOverridesUpdate) {
    const [updatedMapping] = await db
      .update(namespaceToolMappingsTable)
      .set({
        override_name: input.overrideName,
        override_title: input.overrideTitle,
        override_description: input.overrideDescription,
        override_annotations: input.overrideAnnotations,
      })
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, input.namespaceUuid),
          eq(namespaceToolMappingsTable.tool_uuid, input.toolUuid),
          eq(namespaceToolMappingsTable.mcp_server_uuid, input.serverUuid),
        ),
      )
      .returning();

    return updatedMapping;
  }

  /**
   * Server mappings across a set of namespaces, used by the global tool
   * catalog to aggregate one status per MCP server.
   */
  async findServerMappingsByNamespaces(namespaceUuids: string[]) {
    if (namespaceUuids.length === 0) {
      return [];
    }

    return await db
      .select({
        namespace_uuid: namespaceServerMappingsTable.namespace_uuid,
        mcp_server_uuid: namespaceServerMappingsTable.mcp_server_uuid,
        status: namespaceServerMappingsTable.status,
      })
      .from(namespaceServerMappingsTable)
      .where(
        inArray(namespaceServerMappingsTable.namespace_uuid, namespaceUuids),
      );
  }

  /**
   * Tool mappings across a set of namespaces, used by the global tool catalog.
   */
  async findToolMappingsByNamespaces(namespaceUuids: string[]) {
    if (namespaceUuids.length === 0) {
      return [];
    }

    return await db
      .select({
        namespace_uuid: namespaceToolMappingsTable.namespace_uuid,
        tool_uuid: namespaceToolMappingsTable.tool_uuid,
        mcp_server_uuid: namespaceToolMappingsTable.mcp_server_uuid,
        status: namespaceToolMappingsTable.status,
      })
      .from(namespaceToolMappingsTable)
      .where(
        inArray(namespaceToolMappingsTable.namespace_uuid, namespaceUuids),
      );
  }

  /**
   * Set one MCP server's status in every given namespace that already maps it.
   */
  async setServerStatusAcrossNamespaces(input: {
    serverUuid: string;
    namespaceUuids: string[];
    status: "ACTIVE" | "INACTIVE";
  }) {
    if (input.namespaceUuids.length === 0) {
      return [];
    }

    return await db
      .update(namespaceServerMappingsTable)
      .set({ status: input.status })
      .where(
        and(
          eq(namespaceServerMappingsTable.mcp_server_uuid, input.serverUuid),
          inArray(
            namespaceServerMappingsTable.namespace_uuid,
            input.namespaceUuids,
          ),
        ),
      )
      .returning();
  }

  /**
   * Set tool statuses across namespaces. Mappings are upserted so tools that
   * were never mapped (for example, discovered but never refreshed into a
   * namespace) still get an explicit status instead of falling through to the
   * bootstrap policy.
   */
  async setToolsStatusAcrossNamespaces(input: {
    entries: Array<{
      namespaceUuid: string;
      toolUuid: string;
      serverUuid: string;
      status: "ACTIVE" | "INACTIVE";
    }>;
  }) {
    if (input.entries.length === 0) {
      return [];
    }

    return await db
      .insert(namespaceToolMappingsTable)
      .values(
        input.entries.map((entry) => ({
          namespace_uuid: entry.namespaceUuid,
          tool_uuid: entry.toolUuid,
          mcp_server_uuid: entry.serverUuid,
          status: entry.status,
        })),
      )
      .onConflictDoUpdate({
        target: [
          namespaceToolMappingsTable.namespace_uuid,
          namespaceToolMappingsTable.tool_uuid,
        ],
        set: {
          status: sql`excluded.status`,
          mcp_server_uuid: sql`excluded.mcp_server_uuid`,
        },
      })
      .returning();
  }

  async findServerMapping(namespaceUuid: string, serverUuid: string) {
    const [mapping] = await db
      .select()
      .from(namespaceServerMappingsTable)
      .where(
        and(
          eq(namespaceServerMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceServerMappingsTable.mcp_server_uuid, serverUuid),
        ),
      );

    return mapping;
  }

  /**
   * Find all namespace UUIDs that use a specific MCP server
   */
  async findNamespacesByServerUuid(serverUuid: string): Promise<string[]> {
    const mappings = await db
      .select({
        namespace_uuid: namespaceServerMappingsTable.namespace_uuid,
      })
      .from(namespaceServerMappingsTable)
      .where(eq(namespaceServerMappingsTable.mcp_server_uuid, serverUuid));

    return mappings.map((mapping) => mapping.namespace_uuid);
  }

  /**
   * Get all existing tool mappings for a namespace
   */
  async findToolMappingsByNamespace(namespaceUuid: string) {
    const mappings = await db
      .select()
      .from(namespaceToolMappingsTable)
      .where(eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid));

    return mappings;
  }

  async findToolMapping(
    namespaceUuid: string,
    toolUuid: string,
    serverUuid: string,
  ) {
    const [mapping] = await db
      .select()
      .from(namespaceToolMappingsTable)
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceToolMappingsTable.tool_uuid, toolUuid),
          eq(namespaceToolMappingsTable.mcp_server_uuid, serverUuid),
        ),
      );

    return mapping;
  }

  /**
   * Bulk upsert namespace tool mappings for a namespace
   * Used when refreshing tools from MetaMCP connection
   */
  async bulkUpsertNamespaceToolMappings(input: {
    namespaceUuid: string;
    toolMappings: Array<{
      toolUuid: string;
      serverUuid: string;
      status?: "ACTIVE" | "INACTIVE";
    }>;
  }) {
    if (!input.toolMappings || input.toolMappings.length === 0) {
      return [];
    }

    const mappingsToInsert = input.toolMappings.map((mapping) => ({
      namespace_uuid: input.namespaceUuid,
      tool_uuid: mapping.toolUuid,
      mcp_server_uuid: mapping.serverUuid,
      status: (mapping.status || "ACTIVE") as "ACTIVE" | "INACTIVE",
    }));

    // Upsert the mappings - if they exist, update the status; if not, insert them
    return await db
      .insert(namespaceToolMappingsTable)
      .values(mappingsToInsert)
      .onConflictDoUpdate({
        target: [
          namespaceToolMappingsTable.namespace_uuid,
          namespaceToolMappingsTable.tool_uuid,
        ],
        set: {
          status: sql`excluded.status`,
          mcp_server_uuid: sql`excluded.mcp_server_uuid`,
        },
      })
      .returning();
  }
}

export const namespaceMappingsRepository = new NamespaceMappingsRepository();
