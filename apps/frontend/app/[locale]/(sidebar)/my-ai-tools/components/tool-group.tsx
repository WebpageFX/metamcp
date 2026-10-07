"use client";

import { ToolCatalogTool, ToolStatusEnum } from "@repo/zod-types";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/useTranslations";

import { displayToolLabel } from "./tool-risk";

interface ToolGroupProps {
  title: string;
  tools: ToolCatalogTool[];
  onToggleTool: (tool: ToolCatalogTool, nextActive: boolean) => void;
  onBulk: (tools: ToolCatalogTool[], status: "ACTIVE" | "INACTIVE") => void;
  disabled?: boolean;
}

export function ToolGroup({
  title,
  tools,
  onToggleTool,
  onBulk,
  disabled,
}: ToolGroupProps) {
  const { t } = useTranslations();

  if (tools.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <h4 className="text-[0.7rem] font-bold tracking-wide text-muted-foreground uppercase">
          {title}
        </h4>
        <div className="flex gap-2.5">
          <button
            type="button"
            className="text-xs text-primary hover:underline disabled:opacity-50"
            disabled={disabled}
            onClick={() => onBulk(tools, ToolStatusEnum.enum.ACTIVE)}
          >
            {t("my-ai-tools:allOn")}
          </button>
          <button
            type="button"
            className="text-xs text-primary hover:underline disabled:opacity-50"
            disabled={disabled}
            onClick={() => onBulk(tools, ToolStatusEnum.enum.INACTIVE)}
          >
            {t("my-ai-tools:allOff")}
          </button>
        </div>
      </div>

      <div>
        {tools.map((tool) => (
          <div
            key={tool.uuid}
            className="flex items-center gap-2.5 border-b border-border py-2 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium leading-tight">
                  {displayToolLabel(tool)}
                </span>
                {tool.status === "MIXED" ? (
                  <Badge variant="warning">{t("my-ai-tools:mixed")}</Badge>
                ) : null}
              </div>
              {tool.description ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {tool.description}
                </p>
              ) : null}
            </div>
            <Switch
              checked={tool.status !== "INACTIVE"}
              disabled={disabled}
              aria-label={t("my-ai-tools:toggleTool")}
              onCheckedChange={(checked) => onToggleTool(tool, checked)}
              className="h-[17px] w-7"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
