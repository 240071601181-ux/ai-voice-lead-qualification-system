import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BASE = "http://backend.test";

type StartCallFn = (input: { leadId: string }) => Promise<unknown>;

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

describe("startCall service (Calls page Start AI Call)", () => {
  let startCall: StartCallFn;
  let captured: { url: string; init: { method?: string; body?: string } } | null = null;
  const realFetch = (globalThis as any).fetch;

  beforeEach(async () => {
    captured = null;
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", BASE);
    ({ startCall } = await import("@/api/services/calls"));
    (globalThis as any).fetch = vi.fn(async (url: string, init: { method?: string; body?: string }) => {
      captured = { url, init };
      return jsonResponse(201, {
        success: true,
        data: {
          callId: "call-internal-1",
          vapiCallId: "vapi-call-123",
          status: "initiated",
          vapiStatus: "queued",
          leadId: "lead-1",
        },
      });
    });
  });

  afterEach(() => {
    (globalThis as any).fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it("reaches POST /api/v1/calls/start with only the selected leadId", async () => {
    const result = await startCall({ leadId: "lead-1" });
    expect(captured!.url).toBe(`${BASE}/api/v1/calls/start`);
    expect(captured!.init.method).toBe("POST");
    // Only the lead id leaves the client; phone + VAPI key stay server-side.
    expect(JSON.parse(captured!.init.body ?? "{}")).toEqual({ leadId: "lead-1" });
    expect(result).toEqual({
      callId: "call-internal-1",
      vapiCallId: "vapi-call-123",
      status: "initiated",
      vapiStatus: "queued",
      leadId: "lead-1",
    });
  });
});
