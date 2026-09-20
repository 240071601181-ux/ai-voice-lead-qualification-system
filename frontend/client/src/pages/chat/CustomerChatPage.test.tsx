// @vitest-environment jsdom
/**
 * Phase 20 — external customer chat page (real component + real customer
 * hooks, network boundary mocked at fetch only).
 *
 * - /chat/:token redeems the share link, then drops the token from the URL.
 * - Invalid links render the invalid-link state (never admin chrome).
 * - /chat renders the session chat with no admin shell, sends messages,
 *   and signs out.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomerChatPage from "@/pages/chat/CustomerChatPage";
import { frontendEnv } from "@/api/env";

let mockParams: Record<string, string> = {};
const navigateMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/chat", navigateMock],
  useParams: () => mockParams,
}));

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

const pairBody = () => ({
  success: true,
  data: {
    conversation: { id: "conv-1" },
    userMessage: { id: "m-1", role: "user", content: "Hi" },
    assistantMessage: { id: "m-2", role: "assistant", content: "Hello!" },
    qualification: null,
  },
});

function mockFetch() {
  const spy = vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && target.endsWith("/api/v1/customer/session")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.accessToken === "tok-good") {
        return jsonResponse(201, {
          success: true,
          data: {
            conversation: { id: "conv-1", status: "active", channel: "web" },
            expiresAt: "2026-10-01T00:00:00.000Z",
          },
        });
      }
      return jsonResponse(401, { success: false, error: { message: "denied", code: 401 } });
    }
    if (target.endsWith("/api/v1/customer/conversation")) {
      return jsonResponse(200, {
        success: true,
        data: { id: "conv-1", status: "active", channel: "web" },
      });
    }
    if (target.includes("/api/v1/customer/messages")) {
      if (method === "POST") return jsonResponse(201, pairBody());
      return jsonResponse(200, { success: true, data: { messages: [], total: 0, page: 1, limit: 100 } });
    }
    if (target.endsWith("/api/v1/customer/state")) {
      return jsonResponse(200, { success: true, data: null });
    }
    if (target.endsWith("/api/v1/customer/qualification")) {
      return jsonResponse(404, { success: false, error: { message: "missing", code: 404 } });
    }
    if (method === "POST" && target.endsWith("/api/v1/customer/logout")) {
      return jsonResponse(200, { success: true, data: { loggedOut: true } });
    }
    return jsonResponse(404, { success: false, error: { message: "unexpected", code: 404 } });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CustomerChatPage />
    </QueryClientProvider>
  );
}

describe("CustomerChatPage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    mockParams = {};
    navigateMock.mockClear();
    mockFetch();
  });

  afterEach(() => {
    cleanup();
  });

  it("redeems the token, cleans the URL, and renders the chat without admin chrome", async () => {
    mockParams = { token: "tok-good" };
    renderPage();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/chat", { replace: true }));
    // The replace navigates to /chat: a fresh mount in session mode.
    cleanup();
    mockParams = {};
    renderPage();
    await waitFor(() => expect(screen.getByText("Shipment assistant")).toBeInTheDocument());
    // No admin shell: no sidebar navigation, no dashboard links.
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Leads")).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("shows the invalid-link state for bad tokens", async () => {
    mockParams = { token: "tok-bad" };
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/invalid, expired, or revoked/)).toBeInTheDocument()
    );
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Shipment assistant")).not.toBeInTheDocument();
  });

  it("sends a message and signs out in session mode", { timeout: 30000 }, async () => {
    mockParams = {};
    renderPage();
    await waitFor(() => expect(screen.getByText("Shipment assistant")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Type your message/), "Hi");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByText("Hello!")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(screen.getByText(/signed out/)).toBeInTheDocument());
  });
});
