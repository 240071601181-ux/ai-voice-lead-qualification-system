// @vitest-environment jsdom
/**
 * Navigation durability (real page + real hooks, network mocked at fetch).
 *
 * A send fired on ConversationDetailPage must survive unmount/remount
 * (navigate away and back) because execution lives server-side and the
 * MutationCache (global) owns pending/failed send state — never mount state:
 * - pending send + navigate + return → typing persists, completion renders,
 *   no second POST;
 * - failed send + navigate + return → same-key Retry offered, reuse replays;
 * - client-side failure but server completed → stale retry hidden, pair shown;
 * - fresh client on return (browser refresh) → persisted pair renders.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConversationDetailPage from "@/pages/conversations/ConversationDetailPage";
import { frontendEnv } from "@/api/env";

vi.mock("@/api/session", () => ({
  authedRequest: <T,>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> =>
    fn({ Authorization: "Bearer test-token" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/conversations/conv-1", vi.fn()],
  useParams: () => ({ id: "conv-1" }),
}));

// The real AIChatBox renders markdown via streamdown, which pulls a .css
// asset Node cannot load. Stub only the renderer: composer, bubbles, and
// the typing indicator under test stay real.
vi.mock("streamdown", async () => {
  const React = await import("react");
  return {
    Streamdown: ({ children }: { children?: unknown }) =>
      React.createElement(React.Fragment, null, children as React.ReactNode),
  };
});

const JSON_HEADERS = { "content-type": "application/json" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const detailBody = () => ({
  success: true,
  data: {
    conversation: {
      id: "conv-1",
      lead_id: null,
      channel: "web",
      status: "active",
      created_at: "2026-09-19T00:00:00.000Z",
      updated_at: "2026-09-19T00:00:00.000Z",
    },
    lead: null,
    messageCount: 0,
    status: "active",
  },
});

const pairBody = () => {
  const now = Date.now();
  return {
    success: true,
    data: {
      conversation: { id: "conv-1" },
      userMessage: {
        id: "m-1",
        role: "user",
        content: "Change my pickup location to Tambaram.",
        created_at: new Date(now - 1000).toISOString(),
      },
      assistantMessage: {
        id: "m-2",
        role: "assistant",
        content: "Pickup updated to Tambaram.",
        created_at: new Date(now).toISOString(),
      },
      qualification: null,
    },
  };
};

interface Fixture {
  fetchSpy: ReturnType<typeof vi.fn>;
  serverMessages: unknown[];
  resolvePost: ((value: unknown) => void) | null;
  rejectPost: ((reason?: unknown) => void) | null;
  postCount: () => number;
  postKeys: () => Array<string | undefined>;
}

function installFetch(fx: Fixture) {
  const spy = vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && target.endsWith("/conversations/conv-1/messages")) {
      return new Promise<Response>((resolve, reject) => {
        fx.resolvePost = (value: unknown) =>
          resolve(jsonResponse(201, value));
        fx.rejectPost = (reason?: unknown) => reject(reason);
      });
    }
    if (target.includes("/conversations/conv-1/messages")) {
      return jsonResponse(200, {
        success: true,
        data: { messages: fx.serverMessages, total: fx.serverMessages.length, page: 1, limit: 100 },
      });
    }
    if (target.includes("/conversations/conv-1/qualification")) {
      return jsonResponse(404, { success: false, error: { message: "missing", code: 404 } });
    }
    if (target.includes("/conversations/conv-1/state")) {
      return jsonResponse(200, { success: true, data: null });
    }
    if (target.endsWith("/conversations/conv-1")) {
      return jsonResponse(200, detailBody());
    }
    return jsonResponse(404, { success: false, error: { message: "unexpected", code: 404 } });
  });
  vi.stubGlobal("fetch", spy);
  fx.fetchSpy = spy;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, gcTime: 5 * 60_000 },
    },
  });
}

function renderDetail(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ConversationDetailPage />
    </QueryClientProvider>
  );
}

async function sendFirstMessage() {
  const user = userEvent.setup();
  const box = await screen.findByPlaceholderText(/Type your message/);
  await user.type(box, "Change my pickup location to Tambaram.");
  await user.keyboard("{Enter}");
}

describe("ConversationDetailPage navigation durability", () => {
  let fx: Fixture;

  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    fx = {
      fetchSpy: null as unknown as ReturnType<typeof vi.fn>,
      serverMessages: [],
      resolvePost: null,
      rejectPost: null,
  postCount: () =>
    (fx.fetchSpy?.mock.calls ?? []).filter((call: unknown[]) => {
      const [url, init] = call as [unknown, RequestInit | undefined];
      return (
        String(url).endsWith("/conversations/conv-1/messages") &&
        (init?.method ?? "GET").toUpperCase() === "POST"
      );
    }).length,
  postKeys: () =>
    (fx.fetchSpy?.mock.calls ?? [])
      .filter((call: unknown[]) => {
        const [url, init] = call as [unknown, RequestInit | undefined];
        return (
          String(url).endsWith("/conversations/conv-1/messages") &&
          (init?.method ?? "GET").toUpperCase() === "POST"
        );
      })
      .map((call: unknown[]) => {
        const [, init] = call as [unknown, RequestInit | undefined];
        return (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"];
      }),
    };
    installFetch(fx);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the typing state across unmount, renders the result, and never resends", { timeout: 30000 }, async () => {
    const client = makeClient();
    renderDetail(client);
    await sendFirstMessage();

    // Request is in flight (deferred): typing indicator shows.
    await waitFor(() => expect(screen.getByTestId("chat-loading")).toBeInTheDocument());
    expect(fx.postCount()).toBe(1);

    // Navigate away while processing.
    cleanup();

    // Return with the SAME client (SPA navigation keeps the QueryClient):
    // typing persists via the global MutationCache, no second POST.
    renderDetail(client);
    await waitFor(() => expect(screen.getByTestId("chat-loading")).toBeInTheDocument());
    expect(fx.postCount()).toBe(1);

    // Server completes while we watch: pair renders, typing clears.
    fx.serverMessages = [pairBody().data.userMessage, pairBody().data.assistantMessage];
    fx.resolvePost!(pairBody());
    await waitFor(() =>
      expect(screen.getByText("Pickup updated to Tambaram.")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("chat-loading")).not.toBeInTheDocument();
    expect(fx.postCount()).toBe(1);
    expect(
      screen.getAllByText("Change my pickup location to Tambaram.").length
    ).toBe(1);
  });

  it("offers the same-key retry after a failure across unmount", { timeout: 30000 }, async () => {
    const client = makeClient();
    renderDetail(client);
    await sendFirstMessage();
    await waitFor(() => expect(screen.getByTestId("chat-loading")).toBeInTheDocument());
    cleanup();

    // Fail while away, then return: retry is offered (no auto-resend).
    fx.rejectPost!(new TypeError("down"));
    renderDetail(client);
    const retry = await screen.findByText("Retry send");
    expect(retry).toBeInTheDocument();
    expect(fx.postCount()).toBe(1);

    await (userEvent.setup()).click(retry);
    await waitFor(() => expect(fx.postCount()).toBe(2));
    // Same idempotency key: the server replays instead of duplicating.
    const keys = fx.postKeys();
    expect(keys[0]).toBeDefined();
    expect(keys[1]).toBe(keys[0]);

    fx.serverMessages = [pairBody().data.userMessage, pairBody().data.assistantMessage];
    fx.resolvePost!(pairBody());
    await waitFor(() =>
      expect(screen.getByText("Pickup updated to Tambaram.")).toBeInTheDocument()
    );
    await waitFor(() => expect(screen.queryByText("Retry send")).not.toBeInTheDocument());
  });

  it("hides the stale retry when the server actually completed (client timeout case)", async () => {
    const client = makeClient();
    renderDetail(client);
    await sendFirstMessage();
    await waitFor(() => expect(screen.getByTestId("chat-loading")).toBeInTheDocument());
    cleanup();

    // Client saw a failure, but the backend persisted the pair anyway.
    fx.rejectPost!(new TypeError("down"));
    fx.serverMessages = [pairBody().data.userMessage, pairBody().data.assistantMessage];
    renderDetail(client);

    await waitFor(() =>
      expect(screen.getByText("Pickup updated to Tambaram.")).toBeInTheDocument()
    );
    expect(screen.queryByText("Retry send")).not.toBeInTheDocument();
    expect(fx.postCount()).toBe(1);
  });

  it("renders the persisted result on return with a fresh client (browser refresh)", async () => {
    renderDetail(makeClient());
    await sendFirstMessage();
    await waitFor(() => expect(screen.getByTestId("chat-loading")).toBeInTheDocument());
    fx.serverMessages = [pairBody().data.userMessage, pairBody().data.assistantMessage];
    fx.resolvePost!(pairBody());
    await waitFor(() =>
      expect(screen.getByText("Pickup updated to Tambaram.")).toBeInTheDocument()
    );
    cleanup();

    // Refresh: brand-new QueryClient, nothing in memory — server truth wins.
    renderDetail(makeClient());
    await waitFor(() =>
      expect(screen.getByText("Pickup updated to Tambaram.")).toBeInTheDocument()
    );
    expect(
      screen.getAllByText("Change my pickup location to Tambaram.").length
    ).toBe(1);
    expect(screen.queryByTestId("chat-loading")).not.toBeInTheDocument();
    expect(screen.queryByText("Retry send")).not.toBeInTheDocument();
  });
});
