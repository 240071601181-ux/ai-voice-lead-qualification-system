import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followupKeys } from "@/api/hooks/useFollowups";

const BASE = "http://backend.test";

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

describe("followups list query/invalidation behavior", () => {
  let capturedUrl = "";
  const realFetch = (globalThis as any).fetch;

  beforeEach(async () => {
    capturedUrl = "";
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", BASE);
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      capturedUrl = url;
      return jsonResponse(200, {
        success: true,
        data: { followups: [], total: 0, page: 1, limit: 20 },
      });
    });
  });

  afterEach(() => {
    (globalThis as any).fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it("maps status/page/limit to backend query params and unwraps the payload", async () => {
    const { listFollowups } = await import("@/api/services/followups");
    const result = await listFollowups({ status: "pending", page: 2, limit: 5 });
    expect(capturedUrl).toBe(`${BASE}/api/v1/followups?status=pending&page=2&limit=5`);
    expect(result).toEqual({ followups: [], total: 0, page: 1, limit: 20 });
  });

  it("sends only the supported schedule fields when scheduling", async () => {
    const { scheduleFollowup } = await import("@/api/services/followups");
    (globalThis as any).fetch = vi.fn(async (url: string, init: { method?: string; body?: string }) => {
      capturedUrl = `${init.method ?? ""} ${url} ${init.body ?? ""}`;
      return jsonResponse(201, {
        success: true,
        data: { id: "f-1", status: "pending", action: "crm_followup" },
      });
    });
    const result = await scheduleFollowup({ leadId: "lead-1", action: "crm_followup" });
    expect(capturedUrl).toContain("POST");
    expect(capturedUrl).toContain("/api/v1/followups/schedule");
    expect(JSON.parse(capturedUrl.split(" ").slice(2).join(" "))).toEqual({
      leadId: "lead-1",
      action: "crm_followup",
    });
    expect(result).toMatchObject({ id: "f-1", status: "pending" });
  });

  it("nests list keys under followupKeys.all so actions refetch the list", () => {
    const key = followupKeys.list({ status: "pending", page: 1, limit: 20 });
    // Schedule/execute/cancel/retry invalidate followupKeys.all on success;
    // every list key must start with it for the /followups list to refresh.
    expect(key.slice(0, followupKeys.all.length)).toEqual([...followupKeys.all]);
    expect(followupKeys.detail("f-1").slice(0, followupKeys.all.length)).toEqual([...followupKeys.all]);
  });
});
