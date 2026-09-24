"use client";

import { ToolCatalogServer, ToolCatalogTool } from "@repo/zod-types";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/hooks/useTranslations";
import { SupportedLocale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

import { connectionReadiness, ConnectionReadiness } from "./catalog-types";
import { ConnectionCard } from "./connection-card";
import { displayToolLabel } from "./tool-risk";

type StatusFilter = "all" | ConnectionReadiness;

function matchesQuery(server: ToolCatalogServer, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = [
    server.name,
    server.description ?? "",
    ...server.tools.flatMap((tool) => [
      tool.name,
      displayToolLabel(tool),
      tool.description ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

export function ToolsCatalog({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslations();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  const catalogQuery = trpc.frontend.tools.getCatalog.useQuery();

  const onSettled = (result: { success: boolean; message: string }) => {
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    utils.frontend.tools.getCatalog.invalidate();
  };

  const setServerStatus =
    trpc.frontend.tools.setCatalogServerStatus.useMutation({
      onSuccess: onSettled,
      onError: (error) => toast.error(error.message),
    });

  const setToolsStatus = trpc.frontend.tools.setCatalogToolsStatus.useMutation({
    onSuccess: onSettled,
    onError: (error) => toast.error(error.message),
  });

  const servers = catalogQuery.data?.success ? catalogQuery.data.data : [];

  const cards = useMemo(() => {
    const query = search.trim().toLowerCase();
    return servers
      .map((server) => ({ server, readiness: connectionReadiness(server) }))
      .filter((card) => matchesQuery(card.server, query))
      .filter((card) => filter === "all" || card.readiness === filter);
  }, [servers, search, filter]);

  const summary = useMemo(() => {
    const all = servers.map((server) => connectionReadiness(server));
    return {
      ready: all.filter((status) => status === "ready").length,
      needsLook: all.filter((status) => status === "needsLook").length,
      turnedOff: all.filter((status) => status === "turnedOff").length,
    };
  }, [servers]);

  const pending = setServerStatus.isPending || setToolsStatus.isPending;

  const toggleTools = (tools: ToolCatalogTool[], status: "ACTIVE" | "INACTIVE") => {
    if (tools.length === 0) {
      return;
    }
    setToolsStatus.mutate({
      items: tools.map((tool) => ({ toolUuid: tool.uuid, status })),
    });
  };

  return (
    <div className="space-y-4">
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

      {catalogQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
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
        <div className="overflow-hidden rounded-lg border">
          {cards.map((card) => (
            <ConnectionCard
              key={card.server.uuid}
              locale={locale}
              server={card.server}
              readiness={card.readiness}
              pending={pending}
              onToggleServer={(nextActive) =>
                setServerStatus.mutate({
                  serverUuid: card.server.uuid,
                  status: nextActive ? "ACTIVE" : "INACTIVE",
                })
              }
              onToggleTool={(tool, nextActive) =>
                toggleTools([tool], nextActive ? "ACTIVE" : "INACTIVE")
              }
              onBulkTools={toggleTools}
            />
          ))}
        </div>
      )}
    </div>
  );
}
