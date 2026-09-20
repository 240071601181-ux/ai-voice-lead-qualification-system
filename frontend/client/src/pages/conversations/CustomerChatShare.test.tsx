// @vitest-environment jsdom
/**
 * Phase 20 — internal "Customer chat" share panel (real component, network
 * mocked at fetch only).
 *
 * Generate shows the single-use link with expiry for copying; revoke clears
 * it. Failures render truthfully; no raw token is ever stored client-side
 * beyond the displayed link.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerChatShare } from "@/pages/conversations/ConversationDetailPage";
import { frontendEnv } from "@/api/env";

vi.mock("@/api/session", () => ({
  authedRequest: <T,>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> =>
    fn({ Authorization: "Bearer test-token" }),
}));

vi.mock("@/components/AIChatBox", () => ({
  AIChatBox: () => null,
}));

const JSON_HEADERS = { "content-type": "application/json" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

describe("CustomerChatShare", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    const spy = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && target.endsWith("/conversations/conv-1/customer-access")) {
        return jsonResponse(201, {
          success: true,
          data: { url: "http://localhost:3000/chat/tok-share-1", expiresAt: "2026-10-01T00:00:00.000Z" },
        });
      }
      if (method === "POST" && target.endsWith("/conversations/conv-1/customer-access/revoke")) {
        return jsonResponse(200, { success: true, data: { revokedTokens: 1, revokedSessions: 0 } });
      }
      return jsonResponse(404, { success: false, error: { message: "unexpected", code: 404 } });
    });
    vi.stubGlobal("fetch", spy);
  });

  afterEach(() => {
    cleanup();
  });

  function renderShare() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CustomerChatShare conversationId="conv-1" />
      </QueryClientProvider>
    );
  }

  it("generates a link for copying and revokes it", async () => {
    const user = userEvent.setup();
    renderShare();
    await user.click(screen.getByRole("button", { name: /generate customer link/i }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("http://localhost:3000/chat/tok-share-1")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /revoke access/i }));
    await waitFor(() =>
      expect(screen.queryByDisplayValue("http://localhost:3000/chat/tok-share-1")).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /generate customer link/i })).toBeInTheDocument();
  });
});
