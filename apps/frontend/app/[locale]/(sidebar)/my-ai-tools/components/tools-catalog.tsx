"use client";

import {
  McpServerStatusEnum,
  Namespace,
  NamespaceServer,
  NamespaceTool,
  ToolStatusEnum,
} from "@repo/zod-types";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/hooks/useTranslations";
import { SupportedLocale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

import { ConnectionReadiness } from "./catalog-types";
import { ConnectionCard } from "./connection-card";
import { NamespacePicker } from "./namespace-picker";
import { displayToolLabel, isWriteTool } from "./tool-risk";

type StatusFilter = "all" | ConnectionReadiness;

function connectionReadiness(
  server: NamespaceServer,
  tools: NamespaceTool[],
): ConnectionReadiness {
  if (server.status !== McpServerStatusEnum.enum.ACTIVE) {
    return "turnedOff";
  }

  const writeActive = tools.some(
    (tool) =>
      tool.status === ToolStatusEnum.enum.ACTIVE &&
      isWriteTool(tool.name, tool.overrideAnnotations),
  );

  return writeActive ? "needsLook" : "ready";
}

function matchesQuery(
  server: NamespaceServer,
  tools: NamespaceTool[],
  query: string,
): boolean {
  if (!query) {
    return true;
  }

  const haystack = [
    server.name,
    server.description ?? "",
    ...tools.flatMap((tool) => [
      tool.name,
      displayToolLabel(tool),
      tool.description ?? "",
      tool.overrideDescription ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

interface ToolsCatalogProps {
  namespaces: Namespace[];
  namespaceUuid: string;
  onNamespaceChange: (uuid: string) => void;
  locale: SupportedLocale;
}

export function ToolsCatalog({
  namespaces,
  namespaceUuid,
  onNamespaceChange,
  locale,
}: ToolsCatalogProps) {
  const { t } = useTranslations();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  const namespaceQuery = trpc.frontend.namespaces.get.useQuery(
    { uuid: namespaceUuid },
    { enabled: Boolean(namespaceUuid) },
  );
  const toolsQuery = trpc.frontend.namespaces.getTools.useQuery(
    { namespaceUuid },
    { enabled: Boolean(namespaceUuid) },
  );

  const updateServerStatus = trpc.frontend.namespaces.updateServerStatus.useMutation({
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      utils.frontend.namespaces.get.invalidate({ uuid: namespaceUuid });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const updateToolStatus = trpc.frontend.namespaces.updateToolStatus.useMutation({
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      utils.frontend.namespaces.getTools.invalidate({ namespaceUuid });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const updateToolsStatusBulk =
    trpc.frontend.namespaces.updateToolsStatusBulk.useMutation({
      onSuccess: (result) => {
        if (!result.success) {
          toast.error(result.message);
          return;
        }
        utils.frontend.namespaces.getTools.invalidate({ namespaceUuid });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });

  const servers = namespaceQuery.data?.success
    ? (namespaceQuery.data.data?.servers ?? [])
    : [];
  const tools = toolsQuery.data?.success ? toolsQuery.data.data : [];

  const toolsByServer = useMemo(() => {
    const map = new Map<string, NamespaceTool[]>();
    for (const tool of tools) {
      const list = map.get(tool.serverUuid) ?? [];
      list.push(tool);
      map.set(tool.serverUuid, list);
    }
    return map;
  }, [tools]);

  const cards = useMemo(() => {
    const query = search.trim().toLowerCase();
    return servers
      .map((server) => {
        const serverTools = toolsByServer.get(server.uuid) ?? [];
        return {
          server,
          tools: serverTools,
          readiness: connectionReadiness(server, serverTools),
        };
      })
      .filter((card) => matchesQuery(card.server, card.tools, query))
      .filter((card) => filter === "all" || card.readiness === filter);
  }, [servers, toolsByServer, search, filter]);

  const summary = useMemo(() => {
    const all = servers.map((server) =>
      connectionReadiness(server, toolsByServer.get(server.uuid) ?? []),
    );
    return {
      ready: all.filter((status) => status === "ready").length,
      needsLook: all.filter((status) => status === "needsLook").length,
      turnedOff: all.filter((status) => status === "turnedOff").length,
    };
  }, [servers, toolsByServer]);

  const pending =
    updateServerStatus.isPending ||
    updateToolStatus.isPending ||
    updateToolsStatusBulk.isPending;

  const isLoading = namespaceQuery.isLoading || toolsQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <NamespacePicker
          namespaces={namespaces}
          value={namespaceUuid}
          onChange={onNamespaceChange}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("my-ai-tools:searchPlaceholder")}
          className="flex-1"
        />
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", t("my-ai-tools:filterAll")],
              ["ready", t("my-ai-tools:filterReady")],
              ["needsLook", t("my-ai-tools:filterNeedsLook")],
              ["turnedOff", t("my-ai-tools:filterTurnedOff")],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? "default" : "outline"}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
        {t("my-ai-tools:summaryReady", { count: summary.ready })}
        <span className="mx-2">·</span>
        {t("my-ai-tools:summaryNeedsLook", { count: summary.needsLook })}
        <span className="mx-2">·</span>
        {t("my-ai-tools:summaryTurnedOff", { count: summary.turnedOff })}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : servers.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          {t("my-ai-tools:emptyServers")}
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          {t("my-ai-tools:emptySearch")}
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map((card, index) => (
            <ConnectionCard
              key={card.server.uuid}
              namespaceUuid={namespaceUuid}
              locale={locale}
              server={card.server}
              tools={card.tools}
              readiness={card.readiness}
              defaultExpanded={index === 0}
              pending={pending}
              onToggleServer={(nextActive) => {
                updateServerStatus.mutate({
                  namespaceUuid,
                  serverUuid: card.server.uuid,
                  status: nextActive
                    ? McpServerStatusEnum.enum.ACTIVE
                    : McpServerStatusEnum.enum.INACTIVE,
                });
              }}
              onToggleTool={(tool, nextActive) => {
                updateToolStatus.mutate({
                  namespaceUuid,
                  toolUuid: tool.uuid,
                  serverUuid: tool.serverUuid,
                  status: nextActive
                    ? ToolStatusEnum.enum.ACTIVE
                    : ToolStatusEnum.enum.INACTIVE,
                });
              }}
              onBulkTools={(groupTools, status) => {
                updateToolsStatusBulk.mutate({
                  namespaceUuid,
                  items: groupTools.map((tool) => ({
                    toolUuid: tool.uuid,
                    serverUuid: tool.serverUuid,
                    status,
                  })),
                });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
