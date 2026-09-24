import {
  CreateToolRequestSchema,
  GetToolCatalogResponseSchema,
  GetToolsByMcpServerUuidRequestSchema,
  SetCatalogServerStatusRequestSchema,
  SetCatalogStatusResponseSchema,
  SetCatalogToolsStatusRequestSchema,
} from "@repo/zod-types";

import { protectedProcedure, router } from "../../trpc";

export const createToolsRouter = <
  TImplementations extends {
    getByMcpServerUuid: (input: any) => Promise<any>;
    create: (input: any) => Promise<any>;
    sync: (input: any) => Promise<any>;
    getCatalog: (userId: string) => Promise<any>;
    setCatalogServerStatus: (input: any, userId: string) => Promise<any>;
    setCatalogToolsStatus: (input: any, userId: string) => Promise<any>;
  },
>(
  implementations: TImplementations,
) => {
  return router({
    // Protected: Get tools by MCP server UUID
    getByMcpServerUuid: protectedProcedure
      .input(GetToolsByMcpServerUuidRequestSchema)
      .query(async ({ input }) => {
        return implementations.getByMcpServerUuid(input);
      }),

    // Protected: Flat catalog of every MCP server with its tools
    getCatalog: protectedProcedure
      .output(GetToolCatalogResponseSchema)
      .query(async ({ ctx }) => {
        return implementations.getCatalog(ctx.user.id);
      }),

    // Protected: Turn one MCP server on/off across namespaces
    setCatalogServerStatus: protectedProcedure
      .input(SetCatalogServerStatusRequestSchema)
      .output(SetCatalogStatusResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return implementations.setCatalogServerStatus(input, ctx.user.id);
      }),

    // Protected: Turn tools on/off across namespaces
    setCatalogToolsStatus: protectedProcedure
      .input(SetCatalogToolsStatusRequestSchema)
      .output(SetCatalogStatusResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return implementations.setCatalogToolsStatus(input, ctx.user.id);
      }),

    // Protected: Save tools to database (upsert only, no cleanup)
    create: protectedProcedure
      .input(CreateToolRequestSchema)
      .mutation(async ({ input }) => {
        return implementations.create(input);
      }),

    // Protected: Sync tools with cleanup (removes obsolete tools)
    sync: protectedProcedure
      .input(CreateToolRequestSchema)
      .mutation(async ({ input }) => {
        return implementations.sync(input);
      }),
  });
};
