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

function mockBackend() {
  const spy = vi.fn(async (url: unknown) => {
    const target = String(url);
    if (target.endsWith("/health")) {
      return jsonResponse(200, { status: "ok", timestamp: new Date().toISOString() });
    }
    if (target.includes("/api/v1/leads")) {
      return jsonResponse(200, { success: true, data: { leads: [], total: 7, page: 1, limit: 1 } });
    }
    if (target.includes("/api/v1/conversations")) {
      return jsonResponse(200, { success: true, data: { conversations: [], total: 5, page: 1, limit: 1 } });
    }
    if (target.includes("/api/v1/qualifications")) {
      return jsonResponse(200, { success: true, data: { qualifications: [], total: 3, page: 1, limit: 20 } });
    }
    if (target.includes("/api/v1/calendar/bookings")) {
      return jsonResponse(200, { success: true, data: { bookings: [], total: 2, failedCount: 0, page: 1, limit: 1 } });
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
    // Live totals: 7 leads, 5 conversations, 3 qualifications, 2 meetings.
    await waitFor(
      () => {
        for (const value of ["7", "5", "3", "2"]) {
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
});
