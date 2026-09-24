import { z } from "zod";

import { McpServerTypeEnum } from "./mcp-servers.zod";

// Define tool-specific status enum
export const ToolStatusEnum = z.enum(["ACTIVE", "INACTIVE"]);
export type ToolStatus = z.infer<typeof ToolStatusEnum>;

// Tool schema
export const ToolSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable(),
  toolSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.any()).optional(),
    required: z.array(z.string()).optional(),
  }),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  mcp_server_uuid: z.string().uuid(),
});

export type Tool = z.infer<typeof ToolSchema>;

// Get tools by MCP server UUID
export const GetToolsByMcpServerUuidRequestSchema = z.object({
  mcpServerUuid: z.string().uuid(),
});

export const GetToolsByMcpServerUuidResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(ToolSchema),
  message: z.string().optional(),
});

// Save tools to database
export const CreateToolRequestSchema = z.object({
  mcpServerUuid: z.string().uuid(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      inputSchema: z.object({
        type: z.literal("object").optional(),
        properties: z.record(z.string(), z.any()).optional(),
        required: z.array(z.string()).optional(),
      }),
    }),
  ),
});

export const CreateToolResponseSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  message: z.string().optional(),
  error: z.string().optional(),
});

// Export types
export type GetToolsByMcpServerUuidRequest = z.infer<
  typeof GetToolsByMcpServerUuidRequestSchema
>;
export type GetToolsByMcpServerUuidResponse = z.infer<
  typeof GetToolsByMcpServerUuidResponseSchema
>;

export type CreateToolRequest = z.infer<typeof CreateToolRequestSchema>;
export type CreateToolResponse = z.infer<typeof CreateToolResponseSchema>;

// Repository-specific schemas
export const ToolCreateInputSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  toolSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.any()).optional(),
    required: z.array(z.string()).optional(),
  }),
  mcp_server_uuid: z.string(),
});

export const ToolUpsertInputSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable().optional(),
      inputSchema: z
        .object({
          properties: z.record(z.string(), z.any()).optional(),
          required: z.array(z.string()).optional(),
        })
        .optional(),
    }),
  ),
  mcpServerUuid: z.string(),
});

export type ToolCreateInput = z.infer<typeof ToolCreateInputSchema>;
export type ToolUpsertInput = z.infer<typeof ToolUpsertInputSchema>;

// Database-specific schemas (raw database results with Date objects)
export const DatabaseToolSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable(),
  toolSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.any()).optional(),
    required: z.array(z.string()).optional(),
  }),
  created_at: z.date(),
  updated_at: z.date(),
  mcp_server_uuid: z.string(),
});

export type DatabaseTool = z.infer<typeof DatabaseToolSchema>;

// ---------------------------------------------------------------------------
// Global tool catalog ("My AI Tools")
//
// Status is stored per namespace. The catalog aggregates every namespace the
// user can write to, so a server/tool that differs between namespaces reports
// MIXED, and one that belongs to no namespace reports UNAVAILABLE.
// ---------------------------------------------------------------------------

export const ToolCatalogStatusEnum = z.enum([
  "ACTIVE",
  "INACTIVE",
  "MIXED",
  "UNAVAILABLE",
]);
export type ToolCatalogStatus = z.infer<typeof ToolCatalogStatusEnum>;

export const ToolCatalogToolSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: ToolCatalogStatusEnum,
});

export const ToolCatalogServerSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: McpServerTypeEnum,
  status: ToolCatalogStatusEnum,
  namespaceCount: z.number(),
  tools: z.array(ToolCatalogToolSchema),
});

export const GetToolCatalogResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(ToolCatalogServerSchema),
  message: z.string().optional(),
});

export const SetCatalogServerStatusRequestSchema = z.object({
  serverUuid: z.string().uuid(),
  status: ToolStatusEnum,
});

export const SetCatalogToolsStatusRequestSchema = z.object({
  items: z
    .array(
      z.object({
        toolUuid: z.string().uuid(),
        status: ToolStatusEnum,
      }),
    )
    .min(1),
});

export const SetCatalogStatusResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  updatedCount: z.number().optional(),
});

export type ToolCatalogTool = z.infer<typeof ToolCatalogToolSchema>;
export type ToolCatalogServer = z.infer<typeof ToolCatalogServerSchema>;
export type GetToolCatalogResponse = z.infer<
  typeof GetToolCatalogResponseSchema
>;
export type SetCatalogServerStatusRequest = z.infer<
  typeof SetCatalogServerStatusRequestSchema
>;
export type SetCatalogToolsStatusRequest = z.infer<
  typeof SetCatalogToolsStatusRequestSchema
>;
export type SetCatalogStatusResponse = z.infer<
  typeof SetCatalogStatusResponseSchema
>;
