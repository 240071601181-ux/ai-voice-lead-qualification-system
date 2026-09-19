// @vitest-environment jsdom
/**
 * Phase 15 — Automation optional-state tests (real panel + real hooks,
 * network boundary mocked at fetch only).
 *
 * Verifies a disabled n8n shows an honest "not configured + optional"
 * state with no fake workflow metrics, and an enabled n8n shows real
 * configured workflows with real delivery stats.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationPanel } from "@/pages/integrations/AutomationPanel";
import { frontendEnv } from "@/api/env";

vi.mock("@/api/session", () => ({
  authedRequest: <T,>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> =>
    fn({ Authorization: "Bearer test-token" }),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const onToast = vi.fn();

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AutomationPanel onToast={onToast} />
    </QueryClientProvider>
  );
}

describe("AutomationPanel optional state", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
  });

  afterEach(() => {
    cleanup();
  });

  it("shows not-configured + optional messaging with no fake metrics when disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const target = String(url);
        if (target.includes("/n8n/diagnostics")) {
          return jsonResponse(200, {
            success: true,
            data: {
              status: "not_configured",
              checks: [{ name: "enabled", status: "failed", message: "n8n emission is disabled (N8N_ENABLED=false)" }],
              workflowCount: 0,
              eventCount: 0,
              history: { total: 0, delivered: 0, failed: 0, lastStatus: null, lastSyncAt: null },
            },
          });
        }
        if (target.includes("/n8n/workflows")) {
          return jsonResponse(200, { success: true, data: [] });
        }
        return jsonResponse(500, { success: false, error: { message: "unexpected" } });
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getAllByText("n8n is not configured.").length).toBeGreaterThan(0));
    expect(screen.getByText(/n8n is optional/i)).toBeInTheDocument();
    expect(screen.getByText("OPTIONAL INTEGRATION")).toBeInTheDocument();
    expect(screen.queryByText("Operational")).not.toBeInTheDocument();
  });

  it("shows real configured workflows when enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const target = String(url);
        if (target.includes("/n8n/diagnostics")) {
          return jsonResponse(200, {
            success: true,
            data: {
              status: "ok",
              checks: [{ name: "enabled", status: "ok", message: "n8n emission is enabled (N8N_ENABLED=true)" }],
              workflowCount: 1,
              eventCount: 1,
              history: { total: 4, delivered: 3, failed: 1, lastStatus: "delivered", lastSyncAt: "2026-09-19T00:00:00.000Z" },
            },
          });
        }
        if (target.includes("/n8n/workflows")) {
          return jsonResponse(200, {
            success: true,
            data: [{ event: "lead.created", name: "lead-pipeline", urlConfigured: true, deliveries: 4, lastStatus: "delivered", lastDeliveryAt: null }],
          });
        }
        return jsonResponse(500, { success: false, error: { message: "unexpected" } });
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText("Operational")).toBeInTheDocument());
    expect(screen.getByText(/lead\.created → lead-pipeline/)).toBeInTheDocument();
    expect(screen.getAllByText(/4 deliverie\(s\)/).length).toBeGreaterThan(0);
  });
});
