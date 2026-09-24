"use client";

import { NamespaceTool, ToolStatusEnum } from "@repo/zod-types";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/useTranslations";

import { displayToolLabel } from "./tool-risk";

const INITIAL_VISIBLE = 6;

interface ToolGroupProps {
  title: string;
  tools: NamespaceTool[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleTool: (tool: NamespaceTool, nextActive: boolean) => void;
  onBulk: (tools: NamespaceTool[], status: "ACTIVE" | "INACTIVE") => void;
  pending?: boolean;
}

export function ToolGroup({
  title,
  tools,
  expanded,
  onToggleExpanded,
  onToggleTool,
  onBulk,
  pending,
}: ToolGroupProps) {
  const { t } = useTranslations();

  if (tools.length === 0) {
    return null;
  }

  const visible = expanded ? tools : tools.slice(0, INITIAL_VISIBLE);
  const hiddenCount = tools.length - visible.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            className="text-primary hover:underline disabled:opacity-50"
            disabled={pending}
            onClick={() => onBulk(tools, ToolStatusEnum.enum.ACTIVE)}
          >
            {t("my-ai-tools:allOn")}
          </button>
          <button
            type="button"
            className="text-primary hover:underline disabled:opacity-50"
            disabled={pending}
            onClick={() => onBulk(tools, ToolStatusEnum.enum.INACTIVE)}
          >
            {t("my-ai-tools:allOff")}
          </button>
        </div>
      </div>

      <div className="divide-y divide-border/60">
        {visible.map((tool) => {
          const isOn = tool.status === ToolStatusEnum.enum.ACTIVE;
          return (
            <div
              key={tool.uuid}
              className="flex items-start justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <div className="font-medium leading-tight">
                  {displayToolLabel(tool)}
                </div>
                {tool.overrideDescription || tool.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tool.overrideDescription || tool.description}
                  </p>
                ) : null}
              </div>
              <Switch
                checked={isOn}
                disabled={pending}
                aria-label={t("my-ai-tools:toggleTool")}
                onCheckedChange={(checked) => onToggleTool(tool, checked)}
              />
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 ? (
        <Button
          type="button"
          variant="link"
          className="h-auto px-0"
          onClick={onToggleExpanded}
        >
          {t("my-ai-tools:showMore", { count: hiddenCount })}
        </Button>
      ) : tools.length > INITIAL_VISIBLE ? (
        <Button
          type="button"
          variant="link"
          className="h-auto px-0"
          onClick={onToggleExpanded}
        >
          {t("my-ai-tools:showLess")}
        </Button>
      ) : null}
    </div>
  );
}
