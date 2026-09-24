"use client";

import {
  McpServerStatusEnum,
  NamespaceServer,
  NamespaceTool,
  ToolStatusEnum,
} from "@repo/zod-types";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/useTranslations";
import { getLocalizedPath, SupportedLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { ConnectionReadiness } from "./catalog-types";
import { ToolGroup } from "./tool-group";
import { displayToolLabel, humanizeName, isWriteTool } from "./tool-risk";

interface ConnectionCardProps {
  namespaceUuid: string;
  locale: SupportedLocale;
  server: NamespaceServer;
  tools: NamespaceTool[];
  readiness: ConnectionReadiness;
  defaultExpanded?: boolean;
  onToggleServer: (nextActive: boolean) => void;
  onToggleTool: (tool: NamespaceTool, nextActive: boolean) => void;
  onBulkTools: (tools: NamespaceTool[], status: "ACTIVE" | "INACTIVE") => void;
  pending?: boolean;
}

export function ConnectionCard({
  namespaceUuid,
  locale,
  server,
  tools,
  readiness,
  defaultExpanded = false,
  onToggleServer,
  onToggleTool,
  onBulkTools,
  pending,
}: ConnectionCardProps) {
  const { t } = useTranslations();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [toolQuery, setToolQuery] = useState("");
  const [findExpanded, setFindExpanded] = useState(false);
  const [writeExpanded, setWriteExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const serverOn = server.status === McpServerStatusEnum.enum.ACTIVE;
  const activeCount = tools.filter(
    (tool) => tool.status === ToolStatusEnum.enum.ACTIVE,
  ).length;

  const filteredTools = useMemo(() => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) {
      return tools;
    }

    return tools.filter((tool) => {
      const haystack = [
        displayToolLabel(tool),
        tool.name,
        tool.description ?? "",
        tool.overrideDescription ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [tools, toolQuery]);

  const findTools = filteredTools.filter(
    (tool) => !isWriteTool(tool.name, tool.overrideAnnotations),
  );
  const writeTools = filteredTools.filter((tool) =>
    isWriteTool(tool.name, tool.overrideAnnotations),
  );
  const hasWriteCatalog = tools.some((tool) =>
    isWriteTool(tool.name, tool.overrideAnnotations),
  );
  const writeToolsOn = tools.some(
    (tool) =>
      tool.status === ToolStatusEnum.enum.ACTIVE &&
      isWriteTool(tool.name, tool.overrideAnnotations),
  );

  const statusBadge =
    readiness === "turnedOff"
      ? {
          label: t("my-ai-tools:statusTurnedOff"),
          variant: "neutral" as const,
        }
      : readiness === "needsLook"
        ? {
            label: t("my-ai-tools:statusNeedsLook"),
            variant: "warning" as const,
          }
        : {
            label: t("my-ai-tools:statusReady"),
            variant: "success" as const,
          };

  const letter = (server.name.trim()[0] || "?").toUpperCase();

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-start gap-3 p-4">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          onClick={() => setExpanded((value) => !value)}
        >
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold">
            {letter}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold leading-tight">
                {humanizeName(server.name)}
              </h3>
              <span className="text-xs text-muted-foreground">{server.name}</span>
            </div>
            {server.description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {server.description}
              </p>
            ) : null}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            {readiness !== "turnedOff" && !hasWriteCatalog ? (
              <Badge variant="outline">{t("my-ai-tools:readOnly")}</Badge>
            ) : null}
            <span className="text-sm text-muted-foreground">
              {t("my-ai-tools:toolsOn", {
                on: activeCount,
                total: tools.length,
              })}
            </span>
          </div>
          <button
            type="button"
            className="text-muted-foreground"
            aria-expanded={expanded}
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
            disabled={pending}
            aria-label={t("my-ai-tools:toggleMcp")}
            onCheckedChange={onToggleServer}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:hidden">
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        {readiness !== "turnedOff" && !hasWriteCatalog ? (
          <Badge variant="outline">{t("my-ai-tools:readOnly")}</Badge>
        ) : null}
        <span className="text-sm text-muted-foreground">
          {t("my-ai-tools:toolsOn", { on: activeCount, total: tools.length })}
        </span>
      </div>

      {expanded ? (
        <div className="space-y-6 border-t px-4 py-4">
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
            pending={pending}
          />

          <ToolGroup
            title={t("my-ai-tools:createEdit")}
            tools={writeTools}
            expanded={writeExpanded}
            onToggleExpanded={() => setWriteExpanded((value) => !value)}
            onToggleTool={onToggleTool}
            onBulk={onBulkTools}
            pending={pending}
          />

          {writeToolsOn ? (
            <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100">
              <AlertDescription>{t("my-ai-tools:writeWarning")}</AlertDescription>
            </Alert>
          ) : null}

          <div>
            <button
              type="button"
              className={cn(
                "text-sm text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setDetailsOpen((value) => !value)}
            >
              {detailsOpen ? "▾" : "▸"} {t("my-ai-tools:technicalDetails")}
            </button>
            {detailsOpen ? (
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <Link
                  className="text-primary hover:underline"
                  href={getLocalizedPath(`/namespaces/${namespaceUuid}`, locale)}
                >
                  {t("my-ai-tools:viewNamespace")}
                </Link>
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
