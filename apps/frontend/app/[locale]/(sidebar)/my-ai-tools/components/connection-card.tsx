"use client";

import { ToolCatalogServer, ToolCatalogTool } from "@repo/zod-types";
import { ChevronDown, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/useTranslations";
import { getLocalizedPath, SupportedLocale } from "@/lib/i18n";

import {
  accessBadge,
  ConnectionReadiness,
  countToolsOn,
  groupCatalogTools,
  serverIsOn,
} from "./catalog-types";
import { ToolGroup } from "./tool-group";
import {
  connectionInitials,
  displayToolLabel,
  humanizeName,
} from "./tool-risk";

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
}

const pillStyles: Record<ConnectionReadiness, string> = {
  ready: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-400",
  needsLook:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  turnedOff: "bg-muted text-muted-foreground",
};

const dotStyles: Record<ConnectionReadiness, string> = {
  ready: "bg-green-700 dark:bg-green-400",
  needsLook: "bg-amber-600 dark:bg-amber-300",
  turnedOff: "bg-muted-foreground",
};

function formatServerType(type: string): string {
  return type.toLowerCase();
}

function endpointLabel(server: ToolCatalogServer): string {
  if (server.url?.trim()) {
    return server.url.trim();
  }
  if (server.command?.trim()) {
    return server.command.trim();
  }
  return "—";
}

export function ConnectionCard({
  locale,
  server,
  readiness,
  onToggleServer,
  onToggleTool,
  onBulkTools,
}: ConnectionCardProps) {
  const { t } = useTranslations();
  const [expanded, setExpanded] = useState(false);
  const [toolQuery, setToolQuery] = useState("");
  const [moreExpanded, setMoreExpanded] = useState(false);

  const unavailable = server.status === "UNAVAILABLE";
  const on = serverIsOn(server);
  const badge = accessBadge(server);
  const toolsOn = countToolsOn(server);
  const hasError = server.errorStatus === "ERROR";
  const showToolSearch = server.tools.length > 6;

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

  const searching = toolQuery.trim().length > 0;
  const groups = useMemo(
    () => groupCatalogTools(filteredTools, !searching),
    [filteredTools, searching],
  );

  const statusLabel =
    readiness === "turnedOff"
      ? t("my-ai-tools:statusTurnedOff")
      : readiness === "needsLook"
        ? t("my-ai-tools:statusNeedsLook")
        : t("my-ai-tools:statusReady");

  const added = new Date(server.createdAt).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={t("my-ai-tools:expandConnection")}
        >
          <div className="flex size-[30px] shrink-0 items-center justify-center rounded-md bg-primary/10 text-[0.72rem] font-bold text-primary">
            {connectionInitials(server.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-sm font-semibold leading-tight">
                {humanizeName(server.name)}
              </h3>
              <span className="font-mono text-[0.7rem] text-muted-foreground/80">
                {server.name}
              </span>
              {badge === "readOnly" ? (
                <Badge variant="neutral">{t("my-ai-tools:readOnly")}</Badge>
              ) : null}
              {badge === "writeAccess" ? (
                <Badge variant="warning">{t("my-ai-tools:writeAccess")}</Badge>
              ) : null}
            </div>
            {server.description ? (
              <p className="mt-px truncate text-xs text-muted-foreground max-[520px]:hidden">
                {server.description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[0.7rem] font-semibold whitespace-nowrap ${pillStyles[readiness]}`}
            >
              <span
                className={`size-2 shrink-0 rounded-full ${dotStyles[readiness]}`}
              />
              {statusLabel}
            </span>
            {on ? (
              <span className="hidden text-[0.7rem] whitespace-nowrap text-muted-foreground sm:inline">
                {t("my-ai-tools:toolsOn", {
                  on: toolsOn,
                  total: server.tools.length,
                })}
              </span>
            ) : null}
          </div>
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground/70 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        <Switch
          checked={on}
          disabled={unavailable}
          aria-label={t("my-ai-tools:toggleMcp")}
          onCheckedChange={onToggleServer}
        />
      </div>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-border bg-muted/40 px-3.5 py-3.5">
          {on ? (
            <OnBody
              server={server}
              hasError={hasError}
              showWriteWarning={badge === "writeAccess"}
              showToolSearch={showToolSearch}
              toolQuery={toolQuery}
              onToolQuery={setToolQuery}
              searching={searching}
              groups={groups}
              moreExpanded={moreExpanded}
              onExpandMore={() => setMoreExpanded(true)}
              unavailable={unavailable}
              onToggleTool={onToggleTool}
              onBulkTools={onBulkTools}
            />
          ) : (
            <div className="flex flex-col items-start gap-2.5 rounded-lg border border-border bg-background p-3.5">
              {server.description ? (
                <p className="text-sm text-muted-foreground">
                  {server.description}
                </p>
              ) : null}
              {hasError ? <HealthNote /> : null}
              {unavailable ? (
                <p className="text-sm text-muted-foreground">
                  {t("my-ai-tools:notInNamespaceHelp")}
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t("my-ai-tools:turnedOffBody")}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onToggleServer(true)}
                  >
                    {t("my-ai-tools:turnOn")}
                  </Button>
                </>
              )}
            </div>
          )}

          <TechnicalDetails server={server} locale={locale} added={added} />
        </div>
      ) : null}
    </div>
  );
}

function HealthNote() {
  const { t } = useTranslations();

  return (
    <div className="flex items-start gap-2 rounded-lg bg-amber-100 px-2.5 py-2 text-sm leading-snug text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p>{t("my-ai-tools:healthWarning")}</p>
    </div>
  );
}

function OnBody({
  server,
  hasError,
  showWriteWarning,
  showToolSearch,
  toolQuery,
  onToolQuery,
  searching,
  groups,
  moreExpanded,
  onExpandMore,
  unavailable,
  onToggleTool,
  onBulkTools,
}: {
  server: ToolCatalogServer;
  hasError: boolean;
  showWriteWarning: boolean;
  showToolSearch: boolean;
  toolQuery: string;
  onToolQuery: (value: string) => void;
  searching: boolean;
  groups: ReturnType<typeof groupCatalogTools>;
  moreExpanded: boolean;
  onExpandMore: () => void;
  unavailable: boolean;
  onToggleTool: (tool: ToolCatalogTool, nextActive: boolean) => void;
  onBulkTools: (
    tools: ToolCatalogTool[],
    status: "ACTIVE" | "INACTIVE",
  ) => void;
}) {
  const { t } = useTranslations();
  const noMatches =
    searching &&
    groups.find.length === 0 &&
    groups.write.length === 0 &&
    groups.more.length === 0;

  return (
    <>
      {server.description ? (
        <p className="text-sm text-muted-foreground">{server.description}</p>
      ) : null}
      {hasError ? <HealthNote /> : null}
      {showWriteWarning ? (
        <div className="flex items-start gap-2 rounded-lg bg-amber-100 px-2.5 py-2 text-sm leading-snug text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>{t("my-ai-tools:writeWarning")}</p>
        </div>
      ) : null}

      {server.tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("my-ai-tools:noToolsDiscovered")}
        </p>
      ) : (
        <>
          {showToolSearch ? (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={toolQuery}
                onChange={(event) => onToolQuery(event.target.value)}
                placeholder={t("my-ai-tools:searchToolsPlaceholder")}
                className="h-8 bg-background pl-8 text-xs"
              />
            </div>
          ) : null}

          {noMatches ? (
            <p className="py-2 text-sm text-muted-foreground">
              {t("my-ai-tools:noToolMatches")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <ToolGroup
                title={t("my-ai-tools:findThings")}
                tools={groups.find}
                onToggleTool={onToggleTool}
                onBulk={onBulkTools}
                disabled={unavailable}
              />
              <ToolGroup
                title={t("my-ai-tools:createEdit")}
                tools={groups.write}
                onToggleTool={onToggleTool}
                onBulk={onBulkTools}
                disabled={unavailable}
              />
              {groups.more.length > 0 && !moreExpanded ? (
                <button
                  type="button"
                  className="py-1.5 text-left text-sm text-primary hover:underline"
                  onClick={onExpandMore}
                >
                  {t("my-ai-tools:showMore", { count: groups.more.length })} →
                </button>
              ) : null}
              {groups.more.length > 0 && moreExpanded ? (
                <ToolGroup
                  title={t("my-ai-tools:moreTools")}
                  tools={groups.more}
                  onToggleTool={onToggleTool}
                  onBulk={onBulkTools}
                  disabled={unavailable}
                />
              ) : null}
            </div>
          )}
        </>
      )}
    </>
  );
}

function TechnicalDetails({
  server,
  locale,
  added,
}: {
  server: ToolCatalogServer;
  locale: SupportedLocale;
  added: string;
}) {
  const { t } = useTranslations();

  return (
    <details className="group text-xs">
      <summary className="cursor-pointer list-none text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">▸ </span>
        <span className="hidden group-open:inline">▾ </span>
        {t("my-ai-tools:technicalDetails")}
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-background p-2.5">
        <dt className="text-muted-foreground/80">
          {t("my-ai-tools:detailType")}
        </dt>
        <dd className="font-mono break-all text-muted-foreground">
          {formatServerType(server.type)}
        </dd>
        <dt className="text-muted-foreground/80">
          {t("my-ai-tools:detailEndpoint")}
        </dt>
        <dd className="font-mono break-all text-muted-foreground">
          {endpointLabel(server)}
        </dd>
        <dt className="text-muted-foreground/80">
          {t("my-ai-tools:detailAdded")}
        </dt>
        <dd className="text-muted-foreground">{added}</dd>
        <dt className="text-muted-foreground/80">
          {t("my-ai-tools:detailNamespaces")}
        </dt>
        <dd className="text-muted-foreground">{server.namespaceCount}</dd>
      </dl>
      <Link
        className="mt-2 inline-block text-xs text-primary hover:underline"
        href={getLocalizedPath(`/mcp-servers/${server.uuid}`, locale)}
      >
        {t("my-ai-tools:viewServer")}
      </Link>
    </details>
  );
}
