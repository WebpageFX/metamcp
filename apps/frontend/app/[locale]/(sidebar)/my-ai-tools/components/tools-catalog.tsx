"use client";

import {
  GetToolCatalogResponse,
  ToolCatalogServer,
  ToolCatalogTool,
} from "@repo/zod-types";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/hooks/useTranslations";
import { SupportedLocale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

import { connectionReadiness, ConnectionReadiness } from "./catalog-types";
import { ConnectionCard } from "./connection-card";
import { humanizeName } from "./tool-risk";

type StatusFilter = "all" | ConnectionReadiness;
type ToolStatusUpdate = "ACTIVE" | "INACTIVE";

function matchesQuery(server: ToolCatalogServer, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = [
    server.name,
    humanizeName(server.name),
    server.description ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function withServerStatus(
  current: GetToolCatalogResponse | undefined,
  serverUuid: string,
  status: ToolStatusUpdate,
): GetToolCatalogResponse | undefined {
  if (!current?.success) {
    return current;
  }

  return {
    ...current,
    data: current.data.map((server) =>
      server.uuid === serverUuid ? { ...server, status } : server,
    ),
  };
}

function withToolStatuses(
  current: GetToolCatalogResponse | undefined,
  items: { toolUuid: string; status: ToolStatusUpdate }[],
): GetToolCatalogResponse | undefined {
  if (!current?.success) {
    return current;
  }

  const nextStatus = new Map(items.map((item) => [item.toolUuid, item.status]));

  return {
    ...current,
    data: current.data.map((server) => ({
      ...server,
      tools: server.tools.map((tool) => {
        const status = nextStatus.get(tool.uuid);
        return status ? { ...tool, status } : tool;
      }),
    })),
  };
}

export function ToolsCatalog({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslations();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [legendOpen, setLegendOpen] = useState(false);
  const legendRef = useRef<HTMLDivElement>(null);

  const catalogQuery = trpc.frontend.tools.getCatalog.useQuery();

  useEffect(() => {
    if (!legendOpen) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!legendRef.current?.contains(event.target as Node)) {
        setLegendOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [legendOpen]);

  const setServerStatus =
    trpc.frontend.tools.setCatalogServerStatus.useMutation({
      onMutate: async (input) => {
        await utils.frontend.tools.getCatalog.cancel();
        const previous = utils.frontend.tools.getCatalog.getData();
        utils.frontend.tools.getCatalog.setData(undefined, (current) =>
          withServerStatus(current, input.serverUuid, input.status),
        );
        return { previous };
      },
      onError: (error, _input, context) => {
        if (context?.previous) {
          utils.frontend.tools.getCatalog.setData(undefined, context.previous);
        }
        toast.error(error.message);
      },
      onSuccess: (result, _input, context) => {
        if (!result.success) {
          if (context?.previous) {
            utils.frontend.tools.getCatalog.setData(
              undefined,
              context.previous,
            );
          }
          toast.error(result.message);
        }
      },
      onSettled: () => {
        utils.frontend.tools.getCatalog.invalidate();
      },
    });

  const setToolsStatus = trpc.frontend.tools.setCatalogToolsStatus.useMutation({
    onMutate: async (input) => {
      await utils.frontend.tools.getCatalog.cancel();
      const previous = utils.frontend.tools.getCatalog.getData();
      utils.frontend.tools.getCatalog.setData(undefined, (current) =>
        withToolStatuses(current, input.items),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        utils.frontend.tools.getCatalog.setData(undefined, context.previous);
      }
      toast.error(error.message);
    },
    onSuccess: (result, _input, context) => {
      if (!result.success) {
        if (context?.previous) {
          utils.frontend.tools.getCatalog.setData(undefined, context.previous);
        }
        toast.error(result.message);
      }
    },
    onSettled: () => {
      utils.frontend.tools.getCatalog.invalidate();
    },
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

  const toggleTools = (tools: ToolCatalogTool[], status: ToolStatusUpdate) => {
    if (tools.length === 0) {
      return;
    }
    setToolsStatus.mutate({
      items: tools.map((tool) => ({ toolUuid: tool.uuid, status })),
    });
  };

  const filters = [
    ["all", t("my-ai-tools:filterAll")],
    ["ready", t("my-ai-tools:filterReady")],
    ["needsLook", t("my-ai-tools:filterNeedsLook")],
    ["turnedOff", t("my-ai-tools:filterTurnedOff")],
  ] as const;

  return (
    <div>
      <div className="my-4 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("my-ai-tools:searchPlaceholder")}
            className="bg-background pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              className={`rounded-md border px-2.5 py-1.5 text-xs whitespace-nowrap ${
                filter === value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative" ref={legendRef}>
          <button
            type="button"
            className="flex size-[30px] items-center justify-center rounded-md border border-border bg-background text-sm text-muted-foreground"
            aria-expanded={legendOpen}
            aria-label={t("my-ai-tools:legendLabel")}
            onClick={() => setLegendOpen((open) => !open)}
          >
            ?
          </button>
          {legendOpen ? (
            <div className="absolute top-9 right-0 z-20 w-[250px] rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground shadow-lg">
              <LegendRow
                tone="ready"
                label={t("my-ai-tools:statusReady")}
                body={t("my-ai-tools:legendReady")}
              />
              <LegendRow
                tone="needsLook"
                label={t("my-ai-tools:statusNeedsLook")}
                body={t("my-ai-tools:legendNeedsLook")}
              />
              <LegendRow
                tone="turnedOff"
                label={t("my-ai-tools:statusTurnedOff")}
                body={t("my-ai-tools:legendTurnedOff")}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-3.5 flex flex-wrap gap-4 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">{summary.ready}</strong>{" "}
          {t("my-ai-tools:summaryReady")}
        </span>
        <span>
          <strong className="text-foreground">{summary.needsLook}</strong>{" "}
          {t("my-ai-tools:summaryNeedsLook")}
        </span>
        <span>
          <strong className="text-foreground">{summary.turnedOff}</strong>{" "}
          {t("my-ai-tools:summaryTurnedOff")}
        </span>
      </div>

      {catalogQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : servers.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {t("my-ai-tools:emptyServers")}
        </div>
      ) : cards.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {t("my-ai-tools:emptySearch")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-border bg-background">
          {cards.map((card) => (
            <ConnectionCard
              key={card.server.uuid}
              locale={locale}
              server={card.server}
              readiness={card.readiness}
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

function LegendRow({
  tone,
  label,
  body,
}: {
  tone: ConnectionReadiness;
  label: string;
  body: string;
}) {
  const dot =
    tone === "ready"
      ? "bg-green-700 dark:bg-green-400"
      : tone === "needsLook"
        ? "bg-amber-600 dark:bg-amber-300"
        : "bg-muted-foreground";

  return (
    <div className="my-1.5 flex items-start gap-2">
      <span className={`mt-1 size-2 shrink-0 rounded-full ${dot}`} />
      <span>
        <strong className="text-foreground">{label}</strong> — {body}
      </span>
    </div>
  );
}
