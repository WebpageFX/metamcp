import { ToolCatalogServer } from "@repo/zod-types";

import { isWriteTool } from "./tool-risk";

export type ConnectionReadiness = "ready" | "needsLook" | "turnedOff";

/**
 * A server is "turned off" when it is disabled everywhere (or belongs to no
 * namespace), "needs a look" when it can write real data or its namespaces
 * disagree, and "ready" otherwise.
 */
export function connectionReadiness(
  server: ToolCatalogServer,
): ConnectionReadiness {
  if (server.status === "INACTIVE" || server.status === "UNAVAILABLE") {
    return "turnedOff";
  }

  if (server.status === "MIXED") {
    return "needsLook";
  }

  const writeToolOn = server.tools.some(
    (tool) => tool.status !== "INACTIVE" && isWriteTool(tool.name),
  );

  return writeToolOn ? "needsLook" : "ready";
}

export function countToolsOn(server: ToolCatalogServer): number {
  return server.tools.filter((tool) => tool.status === "ACTIVE").length;
}
