import { describe, expect, it } from "vitest";
import { canAccessPath, isAdminOnlyPath } from "@/app/accessPolicy";
import { filterSearchPages } from "@/components/app/searchIndex";

describe("shared route access policy", () => {
  it("allows shared destinations to both canonical roles", () => {
    for (const path of ["/dashboard", "/leads", "/knowledge", "/knowledge/search", "/notifications", "/activity", "/automation", "/profile"]) {
      expect(canAccessPath("ADMIN", path)).toBe(true);
      expect(canAccessPath("USER", path)).toBe(true);
    }
  });

  it("restricts administrator destinations and fails closed for unresolved roles", () => {
    for (const path of ["/ai-agent", "/ai-agent/advanced", "/knowledge/ingest", "/settings"]) {
      expect(isAdminOnlyPath(path)).toBe(true);
      expect(canAccessPath("ADMIN", path)).toBe(true);
      expect(canAccessPath("USER", path)).toBe(false);
      expect(canAccessPath(undefined, path)).toBe(false);
      expect(canAccessPath("OPERATOR", path)).toBe(false);
    }
  });

  it("filters global-search page results using that same policy", () => {
    expect(filterSearchPages("settings", "USER")).toEqual([]);
    expect(filterSearchPages("ai agent", "USER")).toEqual([]);
    expect(filterSearchPages("knowledge", "USER").map((page) => page.path)).toContain("/knowledge");
    expect(filterSearchPages("settings", "ADMIN").map((page) => page.path)).toContain("/settings");
    expect(filterSearchPages("ai agent", "ADMIN").map((page) => page.path)).toContain("/ai-agent");
    expect(filterSearchPages("ingest knowledge", "ADMIN").map((page) => page.path)).toContain("/knowledge/ingest");
    expect(filterSearchPages("ingest knowledge", "USER")).toEqual([]);
    expect(filterSearchPages("", undefined)).toEqual([]);
  });
});
