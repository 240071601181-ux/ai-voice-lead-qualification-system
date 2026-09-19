// @vitest-environment jsdom
/**
 * Phase 12 — QualificationPanel interaction tests (real component + real
 * hooks, network boundary mocked at fetch only).
 *
 * Verifies Score now fires POST /api/v1/conversations/:id/qualification,
 * shows the Scoring loading state, prevents duplicate clicks, updates the
 * displayed qualification on success, and shows truthful errors.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QualificationPanel } from "@/pages/conversations/ConversationDetailPage";
import { frontendEnv } from "@/api/env";

vi.mock("@/api/session", () => ({
  authedRequest: <T,>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> =>
    fn({ Authorization: "Bearer test-token" }),
}));

// The chat box (markdown/katex chain) is irrelevant to this panel test.
vi.mock("@/components/AIChatBox", () => ({
  AIChatBox: () => null,
}));

const JSON_HEADERS = { "content-type": "application/json" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function mockFetch(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  const spy = vi.fn(async (url: unknown, init?: RequestInit) => impl(String(url), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QualificationPanel conversationId="conv-1" />
    </QueryClientProvider>
  );
}

const qualification = {
  id: "q-1", call_id: null, conversation_id: "conv-1", lead_id: "lead-1",
  score: 72, tier: "WARM", details: { criteria: {}, totalScore: 72, qualifiedAt: "2026-09-19T00:00:00.000Z" },
  qualified_at: "2026-09-19T00:00:00.000Z", created_at: "", updated_at: "",
};

describe("QualificationPanel", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the persisted qualification and re-scores on Score now", async () => {
    const user = userEvent.setup();
    const spy = mockFetch((url, init) => {
      if (String(init?.method || "GET") === "POST") {
        return jsonResponse(201, { success: true, data: { ...qualification, score: 80 } });
      }
      return jsonResponse(200, { success: true, data: qualification });
    });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("qualification-score")).toHaveTextContent("Score 72"));

    await user.click(screen.getByRole("button", { name: /score now/i }));
    await waitFor(() => expect(screen.getByTestId("qualification-score")).toHaveTextContent("Score 80"));

    const postCall = spy.mock.calls.find(([u, i]) => String(u).endsWith("/qualification") && i?.method === "POST")!;
    expect(postCall[1]?.headers).toMatchObject({ Authorization: "Bearer test-token" });
  });

  it("shows a loading state and prevents duplicate scoring clicks", async () => {
    const user = userEvent.setup();
    let posts = 0;
    mockFetch((url, init) => {
      if (String(init?.method || "GET") === "POST") {
        posts += 1;
        return new Promise<Response>((resolve) =>
          setTimeout(() => resolve(jsonResponse(201, { success: true, data: qualification })), 50)
        );
      }
      return jsonResponse(404, { success: false, error: { message: "Qualification not found", code: 404 } });
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/not scored yet/i)).toBeInTheDocument());

    const button = screen.getByRole("button", { name: /score now/i });
    await user.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: /scoring/i })).toBeDisabled());
    // Second click while pending must not fire another request.
    await user.click(screen.getByRole("button", { name: /scoring/i })).catch(() => {});
    await waitFor(() => expect(screen.getByTestId("qualification-score")).toBeInTheDocument());
    expect(posts).toBe(1);
  });

  it("shows the backend's truthful message when scoring is not possible", async () => {
    const user = userEvent.setup();
    mockFetch((url, init) => {
      if (String(init?.method || "GET") === "POST") {
        return jsonResponse(422, {
          success: false,
          error: { message: "No conversation state recorded for this conversation yet", code: 422 },
        });
      }
      return jsonResponse(404, { success: false, error: { message: "Qualification not found", code: 404 } });
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/not scored yet/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /score now/i }));
    await waitFor(() =>
      expect(screen.getByText(/no conversation state recorded/i)).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(/no conversation state recorded/i)).not.toBeInTheDocument();
  });
});
