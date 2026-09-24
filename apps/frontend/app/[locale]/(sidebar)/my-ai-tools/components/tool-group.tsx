"use client";

import { ToolCatalogTool, ToolStatusEnum } from "@repo/zod-types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/useTranslations";

import { displayToolLabel } from "./tool-risk";

const INITIAL_VISIBLE = 6;

interface ToolGroupProps {
  title: string;
  tools: ToolCatalogTool[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleTool: (tool: ToolCatalogTool, nextActive: boolean) => void;
  onBulk: (tools: ToolCatalogTool[], status: "ACTIVE" | "INACTIVE") => void;
  disabled?: boolean;
  pending?: boolean;
}

export function ToolGroup({
  title,
  tools,
  expanded,
  onToggleExpanded,
  onToggleTool,
  onBulk,
  disabled,
  pending,
}: ToolGroupProps) {
  const { t } = useTranslations();

  if (tools.length === 0) {
    return null;
  }

  const visible = expanded ? tools : tools.slice(0, INITIAL_VISIBLE);
  const hiddenCount = tools.length - visible.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            className="text-primary hover:underline disabled:opacity-50"
            disabled={pending || disabled}
            onClick={() => onBulk(tools, ToolStatusEnum.enum.ACTIVE)}
          >
            {t("my-ai-tools:allOn")}
          </button>
          <button
            type="button"
            className="text-primary hover:underline disabled:opacity-50"
            disabled={pending || disabled}
            onClick={() => onBulk(tools, ToolStatusEnum.enum.INACTIVE)}
          >
            {t("my-ai-tools:allOff")}
          </button>
        </div>
      </div>

      <div className="divide-y divide-border/60">
        {visible.map((tool) => (
          <div
            key={tool.uuid}
            className="flex items-start justify-between gap-4 py-2.5"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium leading-tight">
                  {displayToolLabel(tool)}
                </span>
                {tool.status === "MIXED" ? (
                  <Badge variant="warning">{t("my-ai-tools:mixed")}</Badge>
                ) : null}
              </div>
              {tool.description ? (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {tool.description}
                </p>
              ) : null}
            </div>
            <Switch
              checked={tool.status !== "INACTIVE"}
              disabled={pending || disabled}
              aria-label={t("my-ai-tools:toggleTool")}
              onCheckedChange={(checked) => onToggleTool(tool, checked)}
            />
          </div>
        ))}
      </div>

      {tools.length > INITIAL_VISIBLE ? (
        <Button
          type="button"
          variant="link"
          className="h-auto px-0"
          onClick={onToggleExpanded}
        >
          {hiddenCount > 0
            ? t("my-ai-tools:showMore", { count: hiddenCount })
            : t("my-ai-tools:showLess")}
        </Button>
      ) : null}
    </div>
  );
}
