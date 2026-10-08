import { ToolCatalogServer } from "@repo/zod-types";

import { isWriteTool } from "./tool-risk";

export type ConnectionReadiness = "ready" | "needsLook" | "turnedOff";
export type AccessBadge = "readOnly" | "writeAccess";

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
