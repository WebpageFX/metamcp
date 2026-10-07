import { ToolCatalogServer, ToolCatalogTool } from "@repo/zod-types";

import { isWriteTool } from "./tool-risk";

export type ConnectionReadiness = "ready" | "needsLook" | "turnedOff";
export type AccessBadge = "readOnly" | "writeAccess";

const VISIBLE_TOOL_LIMIT = 6;

export interface CatalogToolGroups {
  find: ToolCatalogTool[];
  write: ToolCatalogTool[];
  more: ToolCatalogTool[];
}

export function serverIsOn(server: ToolCatalogServer): boolean {
  return server.status === "ACTIVE" || server.status === "MIXED";
}

export function accessBadge(server: ToolCatalogServer): AccessBadge | null {
  if (server.tools.length === 0) {
    return null;
  }

  const writeCount = server.tools.filter((tool) =>
    isWriteTool(tool.name),
  ).length;

  if (writeCount === 0) {
    return "readOnly";
  }

  if (writeCount === server.tools.length) {
    return "writeAccess";
  }

  return null;
}

/**
 * Ready when the server is on and healthy. Needs a look when the connection
 * is in error, namespaces disagree, or a write-only server is turned on.
 * Turned off otherwise, unless that off server is also in error.
 */
export function connectionReadiness(
  server: ToolCatalogServer,
): ConnectionReadiness {
  if (server.errorStatus === "ERROR" || server.status === "MIXED") {
    return "needsLook";
  }

  if (server.status === "INACTIVE" || server.status === "UNAVAILABLE") {
    return "turnedOff";
  }

  if (accessBadge(server) === "writeAccess") {
    return "needsLook";
  }

  return "ready";
}

export function countToolsOn(server: ToolCatalogServer): number {
  return server.tools.filter((tool) => tool.status !== "INACTIVE").length;
}

/**
 * Read tools land in "find" and write tools in "write". When the list is
 * longer than the visible limit, only the first tools stay in those groups
 * and the rest collapse into "more".
 */
export function groupCatalogTools(
  tools: ToolCatalogTool[],
  collapseOverflow: boolean,
): CatalogToolGroups {
  const find: ToolCatalogTool[] = [];
  const write: ToolCatalogTool[] = [];
  const more: ToolCatalogTool[] = [];
  const limit = collapseOverflow
    ? VISIBLE_TOOL_LIMIT
    : Number.POSITIVE_INFINITY;
  let shown = 0;

  for (const tool of tools) {
    if (shown >= limit) {
      more.push(tool);
      continue;
    }

    shown += 1;
    if (isWriteTool(tool.name)) {
      write.push(tool);
    } else {
      find.push(tool);
    }
  }

  return { find, write, more };
}
