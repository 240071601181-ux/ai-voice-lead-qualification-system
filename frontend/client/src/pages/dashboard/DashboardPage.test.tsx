// @vitest-environment jsdom
/**
 * Phase 4 — Dashboard real-data tests (real page + real hooks,
 * network boundary mocked at fetch only).
 *
 * Verifies metric cards, the work queue, recent activity, and integration
 * statuses all render backend data (GET /api/v1/dashboard/summary plus the
 * existing list/diagnostics endpoints) — no fabricated trends, no demo
 * names, no fake "connected/healthy" rows. A failed summary renders "—"
 * with retry, never a zero masquerading as data.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/pages/dashboard/DashboardPage";
import { frontendEnv } from "@/api/env";

vi.mock("@/api/session", () => ({
  authedRequest: <T,>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> =>
    fn({ Authorization: "Bearer test-token" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard", vi.fn()],
  useParams: () => ({}),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const SUMMARY = {
  leads: { total: 7 },
  qualifications: { total: 11, hot: 2, warm: 5, cold: 4 },
  conversations: { total: 6, active: 2, completed: 3, abandoned: 1 },
  followups: { total: 14, pending: 3, processing: 1, completed: 8, failed: 2, cancelled: 0 },
  bookings: { total: 9, upcoming: 2 },
};

function mockBackend(opts?: { summaryStatus?: number; mixOverride?: unknown }) {
  const spy = vi.fn(async (url: unknown) => {
    const target = String(url);
    if (target.endsWith("/health")) {
      return jsonResponse(200, { status: "ok", timestamp: new Date().toISOString() });
    }
    if (target.includes("/api/v1/dashboard/summary")) {
      if (opts?.summaryStatus && opts.summaryStatus !== 200) {
        return jsonResponse(opts.summaryStatus, { success: false, error: { message: "boom" } });
      }
      return jsonResponse(200, { success: true, data: SUMMARY });
    }
    if (target.includes("/api/v1/dashboard/qualification-mix")) {
      return jsonResponse(200, {
        success: true,
        // Distinct from the summary card values so assertions never collide.
        data: opts?.mixOverride ?? { total: 9, hot: 4, warm: 3, cold: 2 },
      });
    }
    if (target.includes("/api/v1/leads")) {
      return jsonResponse(200, { success: true, data: { leads: [], total: 7, page: 1, limit: 4 } });
    }
    if (target.includes("/api/v1/conversations")) {
      return jsonResponse(200, { success: true, data: { conversations: [], total: 6, page: 1, limit: 1 } });
    }
    if (target.includes("/api/v1/qualifications")) {
      return jsonResponse(200, {
        success: true,
        data: {
          qualifications: [
            {
              id: "q-1",
              call_id: null,
              conversation_id: "c-1",
              lead_id: "l-1",
              score: 92,
              tier: "HOT",
              details: null,
              qualified_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          total: 11,
          page: 1,
          limit: 3,
        },
      });
    }
    if (target.includes("/api/v1/followups")) {
      return jsonResponse(200, {
        success: true,
        data: {
          followups: [
            {
              id: "f-1",
              followup_key: "fu:crm_followup:l-1",
              lead_id: "l-1",
              call_id: null,
              qualification_id: null,
              action: "crm_followup",
              payload: {},
              scheduled_at: new Date().toISOString(),
              status: "pending",
              attempts: 0,
              last_error: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          total: 14,
          page: 1,
          limit: 3,
        },
      });
    }
    if (target.includes("/api/v1/calendar/bookings")) {
      return jsonResponse(200, {
        success: true,
        data: {
          bookings: [
            {
              id: "b-1",
              lead_id: "l-1",
              call_id: null,
              provider: "google",
              external_event_id: null,
              meet_url: null,
              scheduled_start: new Date(Date.now() + 86400000).toISOString(),
              scheduled_end: null,
              timezone: "UTC",
              status: "booked",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          total: 9,
          failedCount: 0,
          page: 1,
          limit: 3,
        },
      });
    }
    if (target.includes("/api/v1/crm/diagnostics")) {
      return jsonResponse(200, {
        success: true,
        data: { status: "ok", checks: [], provider: "test", history: {} },
      });
    }
    if (target.includes("/api/v1/whatsapp/diagnostics")) {
      return jsonResponse(200, {
        success: true,
        data: { status: "not_configured", checks: [], provider: "test" },
      });
    }
    if (target.includes("/api/v1/calendar/diagnostics")) {
      return jsonResponse(200, {
        success: true,
        data: { status: "error", checks: [] },
      });
    }
    if (target.includes("/api/v1/n8n/diagnostics")) {
      return jsonResponse(500, { success: false, error: { message: "unavailable" } });
    }
    return jsonResponse(500, { success: false, error: { message: "unexpected" } });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>
  );
}

describe("DashboardPage metrics", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    mockBackend();
    if (typeof window.matchMedia !== "function") {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }
    if (typeof window.IntersectionObserver !== "function") {
      Object.defineProperty(window, "IntersectionObserver", {
        writable: true,
        value: class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      });
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("shows live summary totals and no fabricated metrics", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("My conversations")).toBeInTheDocument());
    // Live summary: 7 leads, 11 qualifications, 6 conversations, 2 upcoming.
    await waitFor(
      () => {
        for (const value of ["7", "11", "6"]) {
          expect(screen.getByText(value)).toBeInTheDocument();
        }
      },
      { timeout: 5000 }
    );
    expect(screen.getByText("Total leads")).toBeInTheDocument();
    expect(screen.getByText("Upcoming meetings")).toBeInTheDocument();
    expect(screen.queryByText("Calls today")).not.toBeInTheDocument();
    expect(screen.queryByText("248")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start ai call/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Voice gateway")).not.toBeInTheDocument();
    // No demo names, no invented trend copy, no fake provider rows.
    expect(screen.queryByText(/Arjun Rao/)).not.toBeInTheDocument();
    expect(screen.queryByText(/99\.8%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Synced 2 min ago/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Everything is flowing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lead volume over time/)).not.toBeInTheDocument();
  });

  it("derives the work queue from the same summary source", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("What needs attention")).toBeInTheDocument());
    await waitFor(
      () => {
        // pending(3) + processing(1).
        expect(screen.getByText("4 follow-ups pending")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(screen.getByText("2 follow-ups failed")).toBeInTheDocument();
    expect(screen.getByText("2 upcoming meetings")).toBeInTheDocument();
    expect(screen.getByText("2 active conversations")).toBeInTheDocument();
  });

  it("shows recent activity from real records only", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Recent activity")).toBeInTheDocument());
    await waitFor(
      () => {
        expect(screen.getByText("Lead scored HOT")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(screen.getByText(/Follow-up pending/)).toBeInTheDocument();
    expect(screen.getByText("Meeting booked")).toBeInTheDocument();
  });

  it("grounds integration statuses in diagnostics results", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Integration status")).toBeInTheDocument());
    await waitFor(
      () => {
        expect(screen.getByText("Verified")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    // The failed probe retries once before settling, so allow time.
    await waitFor(
      () => {
        expect(screen.getByText("Unavailable")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(screen.queryByText("Operational")).not.toBeInTheDocument();
  });

  it("renders the qualification mix from the API with no hardcoded values", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Qualification mix")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("44.4%")).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText("33.3%")).toBeInTheDocument();
    expect(screen.getByText("22.2%")).toBeInTheDocument();
    // No hardcoded demo totals or trend percentages.
    expect(screen.queryByText("1,284")).not.toBeInTheDocument();
    expect(screen.queryByText("186")).not.toBeInTheDocument();
    expect(screen.queryByText(/signal improving/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/8\.4%/)).not.toBeInTheDocument();
  });

  it("shows the empty qualification state when no records exist", async () => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    mockBackend({ mixOverride: { total: 0, hot: 0, warm: 0, cold: 0 } });
    renderPage();
    await waitFor(
      () => expect(screen.getByText("No qualification data yet.")).toBeInTheDocument(),
      { timeout: 5000 }
    );
    expect(screen.getByText(/complete conversations to build/i)).toBeInTheDocument();
  });

  it("never presents a failed summary as zero counts", async () => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    mockBackend({ summaryStatus: 500 });
    renderPage();
    await waitFor(
      () => expect(screen.getByText("Couldn't load dashboard totals")).toBeInTheDocument(),
      { timeout: 5000 }
    );
    // Unavailable placeholders, retry offered, and no fabricated zeros.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /retry/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText("0 follow-ups pending")).not.toBeInTheDocument();
  });
});
