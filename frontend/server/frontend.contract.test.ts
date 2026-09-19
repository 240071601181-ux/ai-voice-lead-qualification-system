import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 14 — frontend route/navigation contract after voice retirement.
 *
 * Replaces the obsolete Home.tsx-based contract (that page never existed in
 * this tree): asserts text-first routing, the /calls → /conversations
 * redirect, and the absence of Calls navigation/search entries.
 */
function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("MadLead AI frontend contract (post-voice)", () => {
  it("routes text-first pages and redirects legacy /calls URLs", () => {
    const routes = read("client/src/app/routes.tsx");
    expect(routes).toContain("/conversations");
    expect(routes).toContain("/conversations/:id");
    expect(routes).toContain("/leads");
    expect(routes).toContain("/qualifications");
    expect(routes).toContain("/followups");
    expect(routes).toContain("/ai-agent");
    expect(routes).toContain("/knowledge");
    expect(routes).not.toContain("CallsPage");
    expect(routes).not.toContain("CallDetailPage");
    expect(routes).toContain('path="/calls"');
    expect(routes).toContain('to="/conversations"');
  });

  it("drops Calls from navigation and search, keeps Conversations", () => {
    const pipeline = read("client/src/mock/pipeline.ts");
    expect(pipeline).not.toMatch(/label:\s*"Calls"/);
    expect(pipeline).toContain('path: "/conversations"');
    const searchIndex = read("client/src/components/app/searchIndex.ts");
    expect(searchIndex).not.toContain('"/calls"');
    expect(searchIndex).toContain('"/conversations"');
  });

  it("keeps qualification tiers and the MadLead brand", () => {
    const pipeline = read("client/src/mock/pipeline.ts");
    expect(pipeline).toContain("MadLead");
    expect(pipeline).toContain("HOT");
    expect(pipeline).toContain("WARM");
    expect(pipeline).toContain("COLD");
  });

  it("brands the shell, login, and browser title as MadLead AI", () => {
    expect(read("client/src/components/app/ui.tsx")).toContain("MadLead <b>AI</b>");
    expect(read("client/src/pages/auth/AuthScreen.tsx")).toContain("MadLead AI turns");
    const html = read("client/index.html");
    expect(html).toContain("<title>MadLead AI");
  });

  it("keeps stale MadVoice/voice-led branding out of customer-facing files", () => {
    const customerFacing = [
      "client/src/components/app/ui.tsx",
      "client/src/pages/auth/AuthScreen.tsx",
      "client/src/pages/auth/AccountCreatedPage.tsx",
      "client/src/pages/auth/VerifyEmailPage.tsx",
      "client/src/pages/auth/ResetPasswordPage.tsx",
      "client/src/pages/system/ProfilePage.tsx",
      "client/src/pages/system/HelpPage.tsx",
      "client/src/pages/integrations/IntegrationPage.tsx",
      "client/src/mock/pipeline.ts",
      "client/src/components/app/searchIndex.ts",
      "client/src/app/routes.tsx",
      "client/index.html",
    ];
    for (const rel of customerFacing) {
      const source = read(rel);
      expect(source, rel).not.toMatch(/madvoice/i);
      expect(source, rel).not.toMatch(/VOICE-LED LOGISTICS OPS/);
    }
  });
});
