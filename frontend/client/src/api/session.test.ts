/**
 * Phase 11 — Session module tests (node-safe, no DOM).
 *
 * Covers login/logout/restore, refresh-once sharing, retry-once semantics,
 * and credential hygiene (tokens live in module memory only — never
 * localStorage, never source).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { frontendEnv } from "@/api/env";
import {
  authedRequest,
  getAccessToken,
  getSessionUser,
  login,
  logout,
  register,
  resetSessionForTests,
  restoreSession,
} from "@/api/session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const loginPayload = (accessToken = "access-1") => ({
  success: true,
  data: {
    user: { id: "user-1", email: "a@example.com", name: "A" },
    accessToken,
    accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  },
});

describe("backend session", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:3000";
    resetSessionForTests();
  });

  it("logs in, exposes the user, and logs out cleanly", async () => {
    const spy = vi.fn(async () => jsonResponse(200, loginPayload()));
    vi.stubGlobal("fetch", spy);
    const user = await login({ email: "a@example.com", password: "password-123" });
    expect(user).toMatchObject({ id: "user-1", email: "a@example.com" });
    expect(getSessionUser()).toMatchObject({ id: "user-1" });
    expect(getAccessToken()).toBe("access-1");
    expect(JSON.parse(String(spy.mock.calls[0][1].body))).toEqual({
      email: "a@example.com",
      password: "password-123",
    });

    spy.mockResolvedValueOnce(jsonResponse(200, { success: true, data: { loggedOut: true } }));
    await logout();
    expect(getSessionUser()).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it("registers with name and surfaces duplicate-email errors safely", async () => {
    const spy = vi.fn(async () => jsonResponse(200, loginPayload()));
    vi.stubGlobal("fetch", spy);
    const user = await register({ email: "n@example.com", password: "password-123", name: "N" });
    expect(user.email).toBe("a@example.com");

    spy.mockResolvedValueOnce(
      jsonResponse(409, { success: false, error: { message: "An account with this email already exists", code: 409 } })
    );
    await expect(
      register({ email: "n@example.com", password: "password-123" })
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("restores the session from the refresh cookie and shares one refresh", async () => {
    let refreshCalls = 0;
    const spy = vi.fn(async (url: string | URL | Request) => {
      const target = String(url instanceof Request ? url.url : url);
      if (target.endsWith("/api/v1/auth/refresh")) {
        refreshCalls += 1;
        return jsonResponse(200, loginPayload());
      }
      return jsonResponse(401, { success: false, error: { message: "expired", code: 401 } });
    });
    vi.stubGlobal("fetch", spy);
    const [a, b] = await Promise.all([restoreSession(), restoreSession()]);
    expect(a).toMatchObject({ id: "user-1" });
    expect(b).toMatchObject({ id: "user-1" });
    expect(refreshCalls).toBe(1);

    // Failed refresh resolves to logged-out, never throws.
    spy.mockReset();
    spy.mockResolvedValue(jsonResponse(401, { success: false, error: { message: "expired", code: 401 } }));
    resetSessionForTests();
    await expect(restoreSession()).resolves.toBeNull();
  });

  it("authedRequest retries once after refresh and never loops", async () => {
    const seen: Array<string | undefined> = [];
    const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url instanceof Request ? url.url : url);
      if (target.endsWith("/api/v1/auth/login")) return jsonResponse(200, loginPayload("stale"));
      if (target.endsWith("/api/v1/auth/refresh")) return jsonResponse(200, loginPayload("fresh"));
      seen.push((init?.headers as Record<string, string> | undefined)?.Authorization);
      if (seen.length === 1) {
        return jsonResponse(401, { success: false, error: { message: "stale", code: 401 } });
      }
      return jsonResponse(200, { success: true, data: { ok: true } });
    });
    vi.stubGlobal("fetch", spy);
    await login({ email: "a@example.com", password: "password-123" });
    const result = await authedRequest((headers) =>
      fetch("http://localhost:3000/api/v1/conversations", { headers }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) {
          const { ApiError, errorKindForStatus } = await import("@/api/errors");
          throw new ApiError(errorKindForStatus(r.status), body.error?.message ?? "failed", r.status);
        }
        return body.data;
      })
    );
    expect(result).toEqual({ ok: true });
    expect(seen).toEqual(["Bearer stale", "Bearer fresh"]);
  });

  it("never stores credentials in web storage", async () => {
    const writes: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: (key: string) => { writes.push(`local:${key}`); },
      removeItem: () => undefined,
      clear: () => undefined,
    });
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: (key: string) => { writes.push(`session:${key}`); },
      removeItem: () => undefined,
      clear: () => undefined,
    });
    const spy = vi.fn(async () => jsonResponse(200, loginPayload()));
    vi.stubGlobal("fetch", spy);
    await login({ email: "a@example.com", password: "password-123" });
    await restoreSession();
    expect(writes).toEqual([]);
  });
});
