"use client";

import { SlidersHorizontal } from "lucide-react";

import { useTranslations } from "@/hooks/useTranslations";

import { ToolsCatalog } from "./components/tools-catalog";

export default function MyAiToolsPage() {
  const { t, locale } = useTranslations();

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <SlidersHorizontal className="size-4" />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t("my-ai-tools:title")}</h1>
          <p className="max-w-3xl text-muted-foreground">
            {t("my-ai-tools:subtitle")}
          </p>
        </div>
      </div>

      <ToolsCatalog locale={locale} />
    </div>
  );
}
