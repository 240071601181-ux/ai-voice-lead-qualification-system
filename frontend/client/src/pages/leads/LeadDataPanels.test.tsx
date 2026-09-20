// @vitest-environment jsdom
/**
 * Phase 19 — conversation-first data panels (real components + real hooks,
 * network boundary mocked at fetch only).
 *
 * - LogisticsStatePanel renders fixed CUSTOMER/SHIPMENT/COMMERCIAL/INTENT/
 *   ADDITIONAL sections from persisted conversation state: real values show,
 *   unknown slots read "Not provided", nothing is invented.
 * - LeadDetailPage renders ONLY live backend records: the customer card, the
 *   latest conversation's shipment slots, and its persisted qualification.
 *   Demo shipment/score/thread content must never appear.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogisticsStatePanel } from "@/pages/conversations/ConversationDetailPage";
import LeadDetailPage from "@/pages/leads/LeadDetailPage";
import { frontendEnv } from "@/api/env";

vi.mock("@/api/session", () => ({
  authedRequest: <T,>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> =>
    fn({ Authorization: "Bearer test-token" }),
}));

vi.mock("@/layouts/AppLayout", () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/leads/lead-1", vi.fn()],
  useParams: () => ({ id: "lead-1" }),
}));

// The chat box (markdown/katex chain) is irrelevant to these panel tests.
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

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const apiLead = {
  id: "lead-1",
  source: "web",
  name: "Santhosh Punnaivanam",
  phone: "+919876543210",
  status: "NEW",
  created_at: "2026-09-19T00:00:00.000Z",
  updated_at: "2026-09-19T00:00:00.000Z",
};

const conv1 = {
  id: "conv-1",
  lead_id: "lead-1",
  channel: "web",
  status: "active",
  created_at: "2026-09-19T00:00:00.000Z",
  updated_at: "2026-09-19T01:00:00.000Z",
};

const state1 = {
  id: "st-1",
  conversation_id: "conv-1",
  customer_name: "Santhosh Punnaivanam",
  pickup_location: "Chennai",
  destination: "Bangalore",
  vehicle_type: null,
  cargo_type: null,
  cargo_weight: null,
  cargo_dimensions: null,
  required_date: null,
  budget: null,
  urgency: null,
  booking_intent: null,
  additional_requirements: null,
};

const FORBIDDEN = [
  "Chennai, Tamil Nadu",
  "Mumbai, Maharashtra",
  "32 ft Multi Axle",
  "Automotive components",
  "14.2 metric tonnes",
  "92",
  "78,000",
  "Arjun",
  "arjun@raoexports.in",
  "High-intent shipper",
  "HS-48211",
];

describe("LogisticsStatePanel sections", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    mockFetch((url) => {
      if (url.includes("/conversations/conv-1/state")) {
        return jsonResponse(200, { success: true, data: state1 });
      }
      return jsonResponse(404, { success: false, error: { message: "unexpected", code: 404 } });
    });
  });

  afterEach(() => cleanup());

  it("groups persisted slots and marks unknowns as Not provided", async () => {
    renderWithClient(<LogisticsStatePanel conversationId="conv-1" />);
    for (const heading of ["CUSTOMER", "SHIPMENT", "COMMERCIAL", "INTENT", "ADDITIONAL"]) {
      await waitFor(() => expect(screen.getByText(heading)).toBeInTheDocument());
    }
    expect(screen.getByText("Chennai")).toBeInTheDocument();
    expect(screen.getByText("Bangalore")).toBeInTheDocument();
    expect(screen.getAllByText("Not provided").length).toBeGreaterThan(0);
    expect(screen.getByText("Source: this conversation.")).toBeInTheDocument();
    for (const fake of ["32 ft Multi Axle", "14.2", "78,000"]) {
      expect(screen.queryByText(fake)).not.toBeInTheDocument();
    }
  });
});

describe("LeadDetailPage real-data only", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
  });

  afterEach(() => cleanup());

  function routerWith(opts: { conversations: unknown[]; state: unknown | null; qualification: unknown | null }) {
    return mockFetch((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.endsWith("/leads/lead-1") && method === "GET") {
        return jsonResponse(200, { success: true, data: apiLead });
      }
      if (url.includes("/conversations?") && method === "GET") {
        return jsonResponse(200, {
          success: true,
          data: { conversations: opts.conversations, total: opts.conversations.length, page: 1, limit: 1 },
        });
      }
      if (url.includes("/conversations/conv-1/state")) {
        return jsonResponse(200, { success: true, data: opts.state });
      }
      if (url.includes("/conversations/conv-1/qualification")) {
        if (opts.qualification === null) {
          return jsonResponse(404, { success: false, error: { message: "missing", code: 404 } });
        }
        return jsonResponse(200, { success: true, data: opts.qualification });
      }
      return jsonResponse(404, { success: false, error: { message: "unexpected", code: 404 } });
    });
  }

  it("shows the live customer record with honest empty sections, never demo content", async () => {
    routerWith({ conversations: [], state: null, qualification: null });
    renderWithClient(<LeadDetailPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Santhosh Punnaivanam" })).toBeInTheDocument()
    );
    expect(screen.getByText("+919876543210")).toBeInTheDocument();
    expect(screen.getByText("Not available — no conversation recorded for this lead yet.")).toBeInTheDocument();
    for (const fake of FORBIDDEN) {
      expect(screen.queryByText(fake)).not.toBeInTheDocument();
    }
    // No fabricated score badge for an unscored lead.
    expect(screen.queryByText("QUALIFICATION SCORE")).not.toBeInTheDocument();
  });

  it("shows conversation-derived shipment and real qualification when present", async () => {
    routerWith({
      conversations: [conv1],
      state: state1,
      qualification: {
        id: "q-1",
        conversation_id: "conv-1",
        score: 55,
        tier: "WARM",
        details: { criteria: {}, totalScore: 55, qualifiedAt: "2026-09-19T00:00:00.000Z" },
        qualified_at: "2026-09-19T00:00:00.000Z",
        created_at: "",
        updated_at: "",
      },
    });
    renderWithClient(<LeadDetailPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Santhosh Punnaivanam" })).toBeInTheDocument()
    );
    await waitFor(() => expect(screen.getByText("Chennai")).toBeInTheDocument());
    expect(screen.getByText("Bangalore")).toBeInTheDocument();
    expect(screen.getAllByText("Not provided").length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Qualification" }));
    await waitFor(() => expect(screen.getByTestId("qualification-score")).toHaveTextContent("Score 55"));
    for (const fake of FORBIDDEN) {
      expect(screen.queryByText(fake)).not.toBeInTheDocument();
    }
  });
});
