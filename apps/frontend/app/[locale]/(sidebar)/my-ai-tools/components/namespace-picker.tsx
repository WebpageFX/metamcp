"use client";

import { Namespace } from "@repo/zod-types";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "@/hooks/useTranslations";

interface NamespacePickerProps {
  namespaces: Namespace[];
  value: string;
  onChange: (uuid: string) => void;
  disabled?: boolean;
}

export function NamespacePicker({
  namespaces,
  value,
  onChange,
  disabled,
}: NamespacePickerProps) {
  const { t } = useTranslations();

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="my-ai-tools-namespace">
        {t("my-ai-tools:namespaceLabel")}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id="my-ai-tools-namespace" className="min-w-[220px]">
          <SelectValue placeholder={t("my-ai-tools:namespaceLabel")} />
        </SelectTrigger>
        <SelectContent>
          {namespaces.map((namespace) => (
            <SelectItem key={namespace.uuid} value={namespace.uuid}>
              {namespace.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
