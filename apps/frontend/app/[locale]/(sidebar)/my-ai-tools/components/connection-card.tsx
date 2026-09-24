"use client";

import { ToolCatalogServer, ToolCatalogTool } from "@repo/zod-types";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/useTranslations";
import { getLocalizedPath, SupportedLocale } from "@/lib/i18n";

import { ConnectionReadiness, countToolsOn } from "./catalog-types";
import { ToolGroup } from "./tool-group";
import { displayToolLabel, humanizeName, isWriteTool } from "./tool-risk";

interface ConnectionCardProps {
  locale: SupportedLocale;
  server: ToolCatalogServer;
  readiness: ConnectionReadiness;
  onToggleServer: (nextActive: boolean) => void;
  onToggleTool: (tool: ToolCatalogTool, nextActive: boolean) => void;
  onBulkTools: (
    tools: ToolCatalogTool[],
    status: "ACTIVE" | "INACTIVE",
  ) => void;
  pending?: boolean;
}

export function ConnectionCard({
  locale,
  server,
  readiness,
  onToggleServer,
  onToggleTool,
  onBulkTools,
  pending,
}: ConnectionCardProps) {
  const { t } = useTranslations();
  const [expanded, setExpanded] = useState(false);
  const [toolQuery, setToolQuery] = useState("");
  const [findExpanded, setFindExpanded] = useState(false);
  const [writeExpanded, setWriteExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const unavailable = server.status === "UNAVAILABLE";
  const serverOn = server.status === "ACTIVE" || server.status === "MIXED";
  const toolsOn = countToolsOn(server);

  const filteredTools = useMemo(() => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) {
      return server.tools;
    }

    return server.tools.filter((tool) =>
      [displayToolLabel(tool), tool.name, tool.description ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [server.tools, toolQuery]);

  const findTools = filteredTools.filter((tool) => !isWriteTool(tool.name));
  const writeTools = filteredTools.filter((tool) => isWriteTool(tool.name));
  const hasWriteCatalog = server.tools.some((tool) => isWriteTool(tool.name));
  const writeToolsOn = server.tools.some(
    (tool) => tool.status !== "INACTIVE" && isWriteTool(tool.name),
  );

  const statusBadge =
    readiness === "turnedOff"
      ? { label: t("my-ai-tools:statusTurnedOff"), variant: "neutral" as const }
      : readiness === "needsLook"
        ? {
            label: t("my-ai-tools:statusNeedsLook"),
            variant: "warning" as const,
          }
        : { label: t("my-ai-tools:statusReady"), variant: "success" as const };

  const letter = (server.name.trim()[0] || "?").toUpperCase();

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold">
            {letter}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold leading-tight">
                {humanizeName(server.name)}
              </h3>
              <span className="font-mono text-xs text-muted-foreground">
                {server.name}
              </span>
              {!hasWriteCatalog && server.tools.length > 0 ? (
                <Badge variant="outline">{t("my-ai-tools:readOnly")}</Badge>
              ) : null}
              {hasWriteCatalog ? (
                <Badge variant="outline">{t("my-ai-tools:writeAccess")}</Badge>
              ) : null}
            </div>
            {server.description ? (
              <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                {server.description}
              </p>
            ) : null}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-3">
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {unavailable
              ? t("my-ai-tools:notInNamespace")
              : t("my-ai-tools:toolsOn", {
                  on: toolsOn,
                  total: server.tools.length,
                })}
          </span>
          <button
            type="button"
            className="text-muted-foreground"
            aria-label={t("my-ai-tools:expandConnection")}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </button>
          <Switch
            checked={serverOn}
            disabled={pending || unavailable}
            aria-label={t("my-ai-tools:toggleMcp")}
            onCheckedChange={onToggleServer}
          />
        </div>
      </div>

      {expanded ? (
        <div className="space-y-5 border-t bg-muted/20 px-4 py-4">
          {unavailable ? (
            <Alert>
              <AlertDescription>
                {t("my-ai-tools:notInNamespaceHelp")}
              </AlertDescription>
            </Alert>
          ) : null}

          {server.tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("my-ai-tools:noToolsDiscovered")}
            </p>
          ) : (
            <>
              <Input
                value={toolQuery}
                onChange={(event) => setToolQuery(event.target.value)}
                placeholder={t("my-ai-tools:searchToolsPlaceholder")}
              />

              <ToolGroup
                title={t("my-ai-tools:findThings")}
                tools={findTools}
                expanded={findExpanded}
                onToggleExpanded={() => setFindExpanded((value) => !value)}
                onToggleTool={onToggleTool}
                onBulk={onBulkTools}
                disabled={unavailable}
                pending={pending}
              />

              <ToolGroup
                title={t("my-ai-tools:createEdit")}
                tools={writeTools}
                expanded={writeExpanded}
                onToggleExpanded={() => setWriteExpanded((value) => !value)}
                onToggleTool={onToggleTool}
                onBulk={onBulkTools}
                disabled={unavailable}
                pending={pending}
              />

              {writeToolsOn ? (
                <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100">
                  <AlertDescription>
                    {t("my-ai-tools:writeWarning")}
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          )}

          <div>
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setDetailsOpen((value) => !value)}
            >
              {detailsOpen ? "▾" : "▸"} {t("my-ai-tools:technicalDetails")}
            </button>
            {detailsOpen ? (
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                <div>
                  {server.type} ·{" "}
                  {t("my-ai-tools:inNamespaces", {
                    count: server.namespaceCount,
                  })}
                </div>
                <Link
                  className="text-primary hover:underline"
                  href={getLocalizedPath(`/mcp-servers/${server.uuid}`, locale)}
                >
                  {t("my-ai-tools:viewServer")}
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
