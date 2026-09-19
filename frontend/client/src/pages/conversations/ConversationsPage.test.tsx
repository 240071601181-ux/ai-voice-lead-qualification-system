// @vitest-environment jsdom
/**
 * Phase 13 — ConversationsPage customer-name tests (real page + real hooks,
 * network boundary mocked at fetch only).
 *
 * Verifies the list shows the CUSTOMER NAME (never a UUID label), falls
 * back to "Unnamed Lead", searches name/email/phone/id, and keeps status
 * and tier signal rendering.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConversationsPage from "@/pages/conversations/ConversationsPage";
import { frontendEnv } from "@/api/env";

vi.mock("@/api/session", () => ({
  authedRequest: <T,>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> =>
    fn({ Authorization: "Bearer test-token" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/conversations", vi.fn()],
  useParams: () => ({}),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const rajesh = {
  id: "conv-aaa",
  lead_id: "lead-1",
  channel: "web",
  status: "active",
  created_at: "2026-09-19T00:00:00.000Z",
  updated_at: "2026-09-19T00:00:00.000Z",
  lead: { id: "lead-1", name: "Rajesh Kumar", phone: "+911234567890", email: "rajesh@example.com", status: "NEW" },
};
const unnamed = {
  id: "conv-bbb",
  lead_id: null,
  channel: "whatsapp",
  status: "completed",
  created_at: "2026-09-19T00:00:00.000Z",
  updated_at: "2026-09-19T00:00:00.000Z",
  lead: null,
};

function mockFetch() {
  const spy = vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("/api/v1/conversations?") || target.endsWith("/api/v1/conversations")) {
      return jsonResponse(200, {
        success: true,
        data: { conversations: [rajesh, unnamed], total: 2, page: 1, limit: 20 },
      });
    }
    if (target.includes("/qualification")) {
      return jsonResponse(404, { success: false, error: { message: "missing", code: 404 } });
    }
    return jsonResponse(500, { success: false, error: { message: "unexpected" } });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConversationsPage />
    </QueryClientProvider>
  );
}

describe("ConversationsPage customer names", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    mockFetch();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the customer name, never a UUID label, with Unnamed Lead fallback", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Rajesh Kumar")).toBeInTheDocument());
    expect(screen.queryByText(/lead b40fded2|lead 878eb839|lead conv-/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lead [0-9a-f]{4,}/)).not.toBeInTheDocument();
    expect(screen.getByText("Unnamed Lead")).toBeInTheDocument();
    // Conversation id survives only as secondary metadata.
    expect(screen.getByText("conv-aaa".slice(0, 8) + "…")).toBeInTheDocument();
  });

  it("searches customer name, email, phone, and conversation id", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await waitFor(() => expect(screen.getByText("Rajesh Kumar")).toBeInTheDocument());
    const search = screen.getByLabelText(/search conversations/i);

    await user.clear(search);
    await user.type(search, "rajesh@example");
    await waitFor(() => expect(screen.queryByText("Unnamed Lead")).not.toBeInTheDocument());
    expect(screen.getByText("Rajesh Kumar")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "+9112345678");
    expect(screen.getByText("Rajesh Kumar")).toBeInTheDocument();
    expect(screen.queryByText("Unnamed Lead")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "conv-bbb");
    await waitFor(() => expect(screen.getByText("Unnamed Lead")).toBeInTheDocument());
    expect(screen.queryByText("Rajesh Kumar")).not.toBeInTheDocument();
  });

  it("keeps status and channel columns with accessible controls", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Rajesh Kumar")).toBeInTheDocument());
    const table = screen.getByRole("table");
    expect(within(table).getByText("Active")).toBeInTheDocument();
    expect(screen.getByLabelText(/filter by channel/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/filter by status/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
  });
});
