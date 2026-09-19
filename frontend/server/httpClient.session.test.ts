import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getUserMessage } from "@/api/errors";
import { request } from "@/api/httpClient";

const BASE = "http://backend.test";

type CapturedInit = { headers?: Record<string, string>; credentials?: RequestCredentials };

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

describe("httpClient platform-session forwarding (session 401 fix)", () => {
  const store = new Map<string, string>();
  let captured: { url: string; init: CapturedInit } | null = null;
  let nextResponse: unknown = { success: true, data: { ok: true } };
  let nextStatus = 200;
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => {
    store.clear();
    captured = null;
    nextResponse = { success: true, data: { ok: true } };
    nextStatus = 200;
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    };
    (globalThis as any).fetch = vi.fn(async (url: string, init: CapturedInit) => {
      captured = { url, init };
      return jsonResponse(nextStatus, nextResponse);
    });
  });

  afterEach(() => {
    (globalThis as any).fetch = realFetch;
    delete (globalThis as any).sessionStorage;
  });

  it("login: sends cookie mode plus the Bearer mirror with an authenticated request", async () => {
    // Logged-in mirror as written by the platform runtime.
    store.set("manus-cookie", "app_session_id=sess-abc; other=x");
    const data = await request<{ ok: boolean }>("POST", "/api/v1/conversations", {
      baseUrl: BASE,
      body: { leadId: "lead-1" },
    });
    expect(data).toEqual({ ok: true });
    expect(captured!.url).toBe(`${BASE}/api/v1/conversations`);
    expect(captured!.init.credentials).toBe("include");
    expect(captured!.init.headers?.["Authorization"]).toBe("Bearer sess-abc");
    expect(captured!.init.headers?.["Content-Type"]).toBe("application/json");
  });

  it("logout: sends no Authorization once the mirror is cleared, keeping cookie mode", async () => {
    // demoLogout()/logout remove the mirror; the server clears the cookie.
    store.delete("manus-cookie");
    await request("POST", "/api/v1/conversations", { baseUrl: BASE, body: { leadId: "lead-1" } });
    expect(captured!.init.credentials).toBe("include");
    expect(captured!.init.headers?.["Authorization"]).toBeUndefined();
  });

  it("still surfaces a real 401 as unauthorized (logout detectable, message preserved)", async () => {
    nextStatus = 401;
    nextResponse = { success: false, error: { message: "Unauthorized", code: 401 } };
    const err = await request("POST", "/api/v1/conversations", {
      baseUrl: BASE,
      body: { leadId: "lead-1" },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("unauthorized");
    expect((err as ApiError).status).toBe(401);
    expect(getUserMessage(err)).toBe("Your session has expired. Please sign in again.");
  });

  it("never overrides an explicit per-request Authorization header", async () => {
    store.set("manus-cookie", "app_session_id=sess-abc");
    await request("GET", "/health", {
      baseUrl: BASE,
      headers: { Authorization: "Bearer explicit" },
    });
    expect(captured!.init.headers?.["Authorization"]).toBe("Bearer explicit");
  });
});
