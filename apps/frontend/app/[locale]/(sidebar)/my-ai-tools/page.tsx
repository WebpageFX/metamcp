"use client";

import { SlidersHorizontal } from "lucide-react";

import { useTranslations } from "@/hooks/useTranslations";

import { ToolsCatalog } from "./components/tools-catalog";

export default function MyAiToolsPage() {
  const { t, locale } = useTranslations();

  return (
    <div className="mx-auto w-full max-w-[820px]">
      <div className="flex items-start gap-3">
        <div className="flex size-[34px] shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <SlidersHorizontal className="size-[18px]" />
        </div>
        <div>
          <h1 className="text-[1.35rem] font-semibold tracking-tight">
            {t("my-ai-tools:title")}
          </h1>
          <p className="mt-1 max-w-[56ch] text-sm text-muted-foreground">
            {t("my-ai-tools:subtitle")}
          </p>
        </div>
      </div>

      <ToolsCatalog locale={locale} />
    </div>
  );
}
