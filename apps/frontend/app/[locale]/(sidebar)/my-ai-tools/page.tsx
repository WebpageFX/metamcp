"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/hooks/useTranslations";
import { getLocalizedPath } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

import { ToolsCatalog } from "./components/tools-catalog";

const STORAGE_KEY = "metamcp.my-ai-tools.namespaceUuid";

export default function MyAiToolsPage() {
  const { t, locale } = useTranslations();
  const [namespaceUuid, setNamespaceUuid] = useState("");

  const namespacesQuery = trpc.frontend.namespaces.list.useQuery();
  const namespaces = namespacesQuery.data?.success
    ? namespacesQuery.data.data
    : [];

  useEffect(() => {
    if (namespaces.length === 0) {
      return;
    }

    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem(STORAGE_KEY)
        : null;
    const storedExists = stored
      ? namespaces.some((namespace) => namespace.uuid === stored)
      : false;

    setNamespaceUuid((current) => {
      if (current && namespaces.some((namespace) => namespace.uuid === current)) {
        return current;
      }
      if (storedExists && stored) {
        return stored;
      }
      return namespaces[0]!.uuid;
    });
  }, [namespaces]);

  const handleNamespaceChange = (uuid: string) => {
    setNamespaceUuid(uuid);
    window.localStorage.setItem(STORAGE_KEY, uuid);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          {t("my-ai-tools:title")}
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          {t("my-ai-tools:subtitle")}
        </p>
      </div>

      {namespacesQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : namespaces.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          <p>{t("my-ai-tools:emptyNamespaces")}</p>
          <Button asChild className="mt-4" variant="outline">
            <a href={getLocalizedPath("/namespaces", locale)}>
              {t("my-ai-tools:goToNamespaces")}
            </a>
          </Button>
        </div>
      ) : namespaceUuid ? (
        <ToolsCatalog
          namespaces={namespaces}
          namespaceUuid={namespaceUuid}
          onNamespaceChange={handleNamespaceChange}
          locale={locale}
        />
      ) : (
        <Skeleton className="h-24 w-full" />
      )}
    </div>
  );
}

