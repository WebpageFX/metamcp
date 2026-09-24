const WRITE_NAME_RE =
  /\b(create|update|delete|edit|write|archive|move|assign|add|remove|set|post|send|publish|upload|rename|comment|merge|close)\b/i;

export type ToolRiskAnnotations = Record<string, unknown> | null | undefined;

export function isWriteTool(
  name: string,
  annotations?: ToolRiskAnnotations,
): boolean {
  if (annotations && typeof annotations === "object") {
    if (annotations.readOnlyHint === true) {
      return false;
    }
    if (annotations.destructiveHint === true) {
      return true;
    }
    if (annotations.readOnlyHint === false) {
      return true;
    }
  }

  const normalized = name.replace(/[_-]+/g, " ");
  return WRITE_NAME_RE.test(normalized);
}

export function humanizeName(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  if (!spaced) {
    return value;
  }

  return spaced.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function displayToolLabel(tool: {
  name: string;
  overrideName?: string | null;
  overrideTitle?: string | null;
}): string {
  if (tool.overrideTitle?.trim()) {
    return tool.overrideTitle.trim();
  }
  if (tool.overrideName?.trim()) {
    return humanizeName(tool.overrideName.trim());
  }
  return humanizeName(tool.name);
}
