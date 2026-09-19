// @vitest-environment jsdom
/**
 * Phase 15 — AI Agent health-metrics tests (real page + real hooks,
 * network boundary mocked at fetch only).
 *
 * Verifies the performance card shows database-backed values, "N/A" (never
 * fabricated numbers) for quality/unavailable metrics, and truthful
 * Active/Paused status (never "Standby").
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AiAgentPage from "@/pages/ai-agent/AiAgentPage";
import { frontendEnv } from "@/api/env";

vi.mock("@/api/session", () => ({
  authedRequest: <T,>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> =>
    fn({ Authorization: "Bearer test-token" }),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const config = {
  name: "MadLead Qualifier", version: "v2.4", paused: false, greeting: "Hi",
  qualificationQuestions: ["q1"], escalationBehavior: "esc", callEnding: "bye",
  languages: ["en"], voice: "voice-1", maxTurns: 10, allowCodeSwitch: true,
  requireConfirmation: false,
};
const health = {
  status: "active", paused: false, name: "x", version: "v2.4",
  liveSession: false, metrics: null, metricsReason: "none collected",
};
const metrics = {
  textConversations: { total: 12, active: 4, completed: 7, abandoned: 1 },
  qualification: { qualifiedConversations: 6, totalConversations: 12, ratePercent: 50 },
  responsiveness: { avgFirstResponseSec: 42.5, conversationsMeasured: 9 },
  quality: null,
  qualityReason: "No deterministic conversation-quality metric exists.",
};

function mockFetch(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  const spy = vi.fn(async (url: unknown, init?: RequestInit) => impl(String(url), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AiAgentPage />
    </QueryClientProvider>
  );
}

describe("AiAgentPage health metrics", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    // jsdom lacks these browser APIs (used by the decorative canvas).
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

  function mockBackend(metricsBody: unknown, metricsStatus = 200) {
    return mockFetch((url) => {
      if (url.endsWith("/agent/config")) return jsonResponse(200, { success: true, data: config });
      if (url.endsWith("/agent/health")) return jsonResponse(200, { success: true, data: health });
      if (url.endsWith("/agent/health-metrics")) {
        return metricsStatus === 200
          ? jsonResponse(200, { success: true, data: metricsBody })
          : jsonResponse(metricsStatus, { success: false, error: { message: "boom" } });
      }
      return jsonResponse(500, { success: false, error: { message: "unexpected" } });
    });
  }

  it("shows live aggregates and N/A quality without fake telemetry", async () => {
    const spy = mockBackend(metrics);
    renderPage();
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("43s")).toBeInTheDocument();
    // Quality is never a number.
    const qualityCell = screen.getByText("Conversation quality").closest("div");
    expect(qualityCell?.parentElement).toHaveTextContent("N/A");
    expect(document.querySelector(".health-badge")?.textContent).toBe("Active");
    expect(screen.queryByText("Standby")).not.toBeInTheDocument();
    const metricsCall = spy.mock.calls.find(([u]) => String(u).endsWith("/agent/health-metrics"))!;
    expect(metricsCall[1]?.method ?? "GET").toBe("GET");
  });

  it("shows N/A (not estimates) when metrics are unavailable", async () => {
    mockBackend(null, 500);
    renderPage();
    await waitFor(
      () => expect(screen.getByText(/showing N\/A instead of estimates/i)).toBeInTheDocument(),
      { timeout: 5000 }
    );
  });

  it("shows Paused when the agent is paused", async () => {
    mockFetch((url) => {
      if (url.endsWith("/agent/config")) {
        return jsonResponse(200, { success: true, data: { ...config, paused: true } });
      }
      if (url.endsWith("/agent/health")) {
        return jsonResponse(200, { success: true, data: { ...health, paused: true, status: "paused" } });
      }
      return jsonResponse(200, { success: true, data: metrics });
    });
    renderPage();
    await waitFor(() => {
      const badge = document.querySelector(".health-badge");
      expect(badge?.textContent).toBe("Paused");
    });
  });
});
