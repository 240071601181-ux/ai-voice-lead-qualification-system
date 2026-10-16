import { describe, expect, it } from "vitest";
import { SEARCH_PAGES, filterSearchPages } from "@/components/app/searchIndex";

/**
 * Phase 5 — search obeys the shared access policy: a role is required and
 * unknown roles see nothing (fail-closed). ADMIN sees every page; USER sees
 * every shared page but never administrator-only destinations.
 */
describe("global search page index", () => {
  it("covers the required application routes with real paths", () => {
    const paths = SEARCH_PAGES.map((p) => p.path);
    for (const required of [
      "/dashboard",
      "/leads",
      "/conversations",
      "/qualifications",
      "/followups",
      "/calendar",
      "/knowledge",
      "/ai-agent",
      "/crm",
      "/whatsapp",
      "/automation",
      "/activity",
      "/notifications",
      "/settings",
      "/profile",
      "/help",
    ]) {
      expect(paths).toContain(required);
    }
    // Phase 14: legacy voice Calls retired — old /calls URLs redirect.
    expect(paths).not.toContain("/calls");
  });

  it("matches a page name such as Calendar", () => {
    const hits = filterSearchPages("Calendar", "ADMIN");
    expect(hits.map((p) => p.path)).toContain("/calendar");
  });

  it("matches case-insensitively across labels, paths, and keywords", () => {
    expect(filterSearchPages("cal", "ADMIN").map((p) => p.path)).toContain("/calendar");
    expect(filterSearchPages("LEADS", "USER").map((p) => p.path)).toContain("/leads");
    expect(filterSearchPages("conversations", "USER").map((p) => p.path)).toContain("/conversations");
  });

  it("returns everything visible on empty query and nothing on no-match", () => {
    expect(filterSearchPages("", "ADMIN")).toHaveLength(SEARCH_PAGES.length);
    expect(filterSearchPages("zzz-no-such-page", "ADMIN")).toEqual([]);
  });

  it("fails closed for unknown roles", () => {
    expect(filterSearchPages("Calendar", undefined)).toEqual([]);
    expect(filterSearchPages("Calendar", "OPERATOR")).toEqual([]);
    expect(filterSearchPages("", undefined)).toEqual([]);
  });

  it("never exposes administrator-only pages to USER", () => {
    const paths = filterSearchPages("", "USER").map((p) => p.path);
    expect(paths).toContain("/calendar");
    expect(paths).toContain("/knowledge");
    for (const adminOnly of ["/ai-agent", "/knowledge/ingest", "/settings"]) {
      expect(paths).not.toContain(adminOnly);
    }
    expect(filterSearchPages("agent", "USER").map((p) => p.path)).not.toContain("/ai-agent");
    expect(filterSearchPages("ingest", "ADMIN").map((p) => p.path)).toContain("/knowledge/ingest");
  });
});
