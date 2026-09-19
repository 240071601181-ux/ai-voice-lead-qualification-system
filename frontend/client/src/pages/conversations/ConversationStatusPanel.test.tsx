// @vitest-environment jsdom
/**
 * Phase 12 — ConversationStatusPanel interaction tests (real component +
 * real hooks, network boundary mocked at fetch only).
 *
 * Verifies Complete/Abandon fire the correct POST endpoints with auth,
 * confirm-dialog flow, pending states, cache invalidation, and truthful
 * errors. Buttons stay disabled unless the conversation is active.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationStatusPanel } from "@/pages/conversations/ConversationDetailPage";
import { conversationKeys } from "@/api/hooks/useConversations";
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

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: unknown, init?: RequestInit) => impl(String(url), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderPanel(status: string | undefined, client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ConversationStatusPanel conversationId="conv-1" status={status} />
    </QueryClientProvider>
  );
  return queryClient;
}

const completedConversation = {
  id: "conv-1", lead_id: "lead-1", channel: "web", status: "completed",
  created_at: "", updated_at: "",
};

describe("ConversationStatusPanel", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
  });

  afterEach(() => {
    cleanup();
  });

  it("disables Complete/Abandon unless the conversation is active", () => {
    renderPanel("completed");
    expect(screen.getByTestId("status-value")).toHaveTextContent("Completed");
    expect(screen.getByRole("button", { name: /^complete$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^abandon$/i })).toBeDisabled();
  });

  it("completes via POST with auth and refreshes the detail cache", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    let resolvePost!: (r: Response) => void;
    const postGate = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const spy = mockFetch((url, init) =>
      String(init?.method) === "POST" && String(url).endsWith("/complete")
        ? postGate
        : jsonResponse(500, { success: false, error: { message: "unexpected" } })
    );
    renderPanel("active", client);

    await user.click(screen.getByRole("button", { name: /^complete$/i }));
    // Confirm through the dialog (radix unmounts it on confirm, so the
    // pending state is observed on the trigger, which stays mounted).
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^complete$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^complete$/i })).toBeDisabled()
    );
    resolvePost(jsonResponse(200, { success: true, data: completedConversation }));
    await waitFor(() =>
      expect(spy.mock.calls.some(([u, i]) => String(u).endsWith("/complete") && i?.method === "POST")).toBe(true)
    );
    const call = spy.mock.calls.find(([u]) => String(u).endsWith("/complete"))!;
    expect(call[0]).toBe("http://localhost:4000/api/v1/conversations/conv-1/complete");
    expect(call[1]?.headers).toMatchObject({ Authorization: "Bearer test-token" });
    await waitFor(() =>
      expect(
        invalidateSpy.mock.calls.some(
          ([arg]) => JSON.stringify(arg).includes(JSON.stringify(conversationKeys.detail("conv-1")))
        )
      ).toBe(true)
    );
  });

  it("shows the truthful message when the action is not available (409)", async () => {
    const user = userEvent.setup();
    mockFetch(() =>
      jsonResponse(409, {
        success: false,
        error: { message: "Conversation is abandoned and cannot schedule meetings", code: 409 },
      })
    );
    renderPanel("active");
    await user.click(screen.getByRole("button", { name: /^abandon$/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^abandon$/i }));
    await waitFor(() =>
      expect(screen.getByText("That action is not available for this conversation.")).toBeInTheDocument()
    );
  });
});
