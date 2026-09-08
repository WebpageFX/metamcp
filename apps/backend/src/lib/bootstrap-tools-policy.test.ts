import { describe, expect, it } from "vitest";

import {
  isDefaultInactivePolicy,
  normalizeToolsConfig,
  resolveEffectiveToolStatus,
  resolveToolStatus,
} from "./bootstrap-tools-policy";

describe("normalizeToolsConfig", () => {
  it("returns null for empty objects", () => {
    expect(normalizeToolsConfig({})).toBeNull();
    expect(normalizeToolsConfig(null)).toBeNull();
  });

  it("accepts enable/disable aliases and default", () => {
    expect(
      normalizeToolsConfig({
        default: "INACTIVE",
        enabled: [" a ", "b"],
        disabled: ["c"],
      }),
    ).toEqual({
      default: "inactive",
      enable: ["a", "b"],
      disable: ["c"],
    });
  });
});

describe("resolveToolStatus", () => {
  it("applies disable over enable over default", () => {
    const policy = {
      default: "inactive" as const,
      enable: ["keep", "also_disabled"],
      disable: ["also_disabled", "drop"],
    };

    expect(resolveToolStatus("keep", policy)).toBe("ACTIVE");
    expect(resolveToolStatus("also_disabled", policy)).toBe("INACTIVE");
    expect(resolveToolStatus("drop", policy)).toBe("INACTIVE");
    expect(resolveToolStatus("other", policy)).toBe("INACTIVE");
  });

  it("defaults to active when default omitted", () => {
    expect(resolveToolStatus("x", { enable: [], disable: [] })).toBe("ACTIVE");
  });
});

describe("resolveEffectiveToolStatus", () => {
  it("prefers explicit mapping over policy", () => {
    const policy = { default: "inactive" as const, enable: ["keep"] };
    expect(resolveEffectiveToolStatus("other", "ACTIVE", policy)).toBe(
      "ACTIVE",
    );
    expect(resolveEffectiveToolStatus("keep", "INACTIVE", policy)).toBe(
      "INACTIVE",
    );
  });

  it("fail-closes unmapped tools when default is inactive", () => {
    const policy = {
      default: "inactive" as const,
      enable: ["keep"],
    };
    expect(resolveEffectiveToolStatus("keep", null, policy)).toBe("ACTIVE");
    expect(resolveEffectiveToolStatus("secret_write", null, policy)).toBe(
      "INACTIVE",
    );
  });

  it("keeps legacy fail-open when no policy exists", () => {
    expect(resolveEffectiveToolStatus("anything", null, null)).toBeNull();
  });
});

describe("isDefaultInactivePolicy", () => {
  it("detects explicit inactive default", () => {
    expect(isDefaultInactivePolicy({ default: "inactive" })).toBe(true);
    expect(isDefaultInactivePolicy({ default: "active" })).toBe(false);
    expect(isDefaultInactivePolicy({ enable: ["a"] })).toBe(false);
  });
});
