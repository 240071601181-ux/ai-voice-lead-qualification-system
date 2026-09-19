// @vitest-environment jsdom
/**
 * Phase 15 — Dashboard metric honesty tests (real page + real hooks,
 * network boundary mocked at fetch only).
 *
 * Verifies metric cards show database-backed totals only (no demo numbers,
 * no voice metrics, no Start AI Call action).
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

function mockBackend(mixOverride?: unknown) {
  const spy = vi.fn(async (url: unknown) => {
    const target = String(url);
    if (target.endsWith("/health")) {
      return jsonResponse(200, { status: "ok", timestamp: new Date().toISOString() });
    }
    if (target.includes("/api/v1/dashboard/qualification-mix")) {
      return jsonResponse(200, {
        success: true,
        data: mixOverride ?? { total: 10, hot: 2, warm: 5, cold: 3 },
      });
    }
    if (target.includes("/api/v1/leads")) {
      return jsonResponse(200, { success: true, data: { leads: [], total: 7, page: 1, limit: 1 } });
    }
    if (target.includes("/api/v1/conversations")) {
      return jsonResponse(200, { success: true, data: { conversations: [], total: 6, page: 1, limit: 1 } });
    }
    if (target.includes("/api/v1/qualifications")) {
      return jsonResponse(200, { success: true, data: { qualifications: [], total: 11, page: 1, limit: 20 } });
    }
    if (target.includes("/api/v1/calendar/bookings")) {
      return jsonResponse(200, { success: true, data: { bookings: [], total: 4, failedCount: 0, page: 1, limit: 1 } });
    }
    return jsonResponse(500, { success: false, error: { message: "unexpected" } });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
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

  it("shows live database totals and no voice metrics", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardPage />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText("Conversations")).toBeInTheDocument());
    // Live totals: 7 leads, 6 conversations, 11 qualifications, 4 meetings
    // (all distinct so card values never collide with donut counts).
    await waitFor(
      () => {
        for (const value of ["7", "6", "11", "4"]) {
          expect(screen.getByText(value)).toBeInTheDocument();
        }
      },
      { timeout: 5000 }
    );
    expect(screen.getByText("Meetings scheduled")).toBeInTheDocument();
    expect(screen.queryByText("Calls today")).not.toBeInTheDocument();
    expect(screen.queryByText("248")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start ai call/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Voice gateway")).not.toBeInTheDocument();
  });

  it("renders the qualification mix from the API with no hardcoded values", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardPage />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText("Qualification mix")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("20%")).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    // No hardcoded demo totals or trend percentages.
    expect(screen.queryByText("1,284")).not.toBeInTheDocument();
    expect(screen.queryByText("186")).not.toBeInTheDocument();
    expect(screen.queryByText(/signal improving/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/8\.4%/)).not.toBeInTheDocument();
  });

  it("shows the empty qualification state when no records exist", async () => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    mockBackend({ total: 0, hot: 0, warm: 0, cold: 0 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardPage />
      </QueryClientProvider>
    );
    await waitFor(
      () => expect(screen.getByText("No qualification data yet.")).toBeInTheDocument(),
      { timeout: 5000 }
    );
    expect(screen.getByText(/complete conversations to build/i)).toBeInTheDocument();
  });
});
