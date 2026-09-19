import { describe, expect, it } from "vitest";
import { SEARCH_PAGES, filterSearchPages } from "@/components/app/searchIndex";

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
    const hits = filterSearchPages("Calendar");
    expect(hits.map((p) => p.path)).toContain("/calendar");
  });

  it("matches case-insensitively across labels, paths, and keywords", () => {
    expect(filterSearchPages("cal").map((p) => p.path)).toContain("/calendar");
    expect(filterSearchPages("LEADS").map((p) => p.path)).toContain("/leads");
    expect(filterSearchPages("conversations").map((p) => p.path)).toContain("/conversations");
  });

  it("returns everything on empty query and nothing on no-match", () => {
    expect(filterSearchPages("")).toHaveLength(SEARCH_PAGES.length);
    expect(filterSearchPages("zzz-no-such-page")).toEqual([]);
  });
});
