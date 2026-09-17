/**
 * Phase 9 — Conversation API service tests.
 * Phase 11 — authenticated via the backend session (no pasted tokens).
 *
 * Mocks the network boundary (global fetch) only: asserts request paths,
 * methods, bodies, the session Authorization header (with refresh-once
 * retry), envelope unwrapping, and user-safe error kinds.
 * No business logic is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/errors";
import { frontendEnv } from "@/api/env";
import { resetSessionForTests } from "@/api/session";
import {
  abandonConversation,
  bookConversationMeeting,
  completeConversation,
  createConversation,
  getConversation,
  getConversationAvailability,
  getConversationMessages,
  getConversationQualification,
  getConversationState,
  listConversations,
  qualifyConversation,
  sendConversationMessage,
} from "@/api/services/conversations";

const JSON_HEADERS = { "content-type": "application/json" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function mockFetchOnce(status: number, body: unknown) {
  const spy = vi.fn(async () => jsonResponse(status, body));
  vi.stubGlobal("fetch", spy);
  return spy;
}

const loginPayload = (accessToken = "access-1") => ({
  success: true,
  data: {
    user: { id: "user-1", email: "a@example.com" },
    accessToken,
    accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  },
});

describe("conversations API service", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:3000";
    resetSessionForTests();
  });

  /** Seed a logged-in session (the login response is the only token source). */
  async function loginAs(fetchSpy: ReturnType<typeof vi.fn>, accessToken = "access-1") {
    const { login } = await import("@/api/session");
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, loginPayload(accessToken)));
    await login({ email: "a@example.com", password: "password-123" });
  }

  it("lists conversations with filters and pagination", async () => {
    const spy = mockFetchOnce(200, {
      success: true,
      data: { conversations: [], total: 0, page: 2, limit: 20 },
    });
    await loginAs(spy);
    const result = await listConversations({ status: "active", channel: "web", page: 2, limit: 20 });
    expect(result.total).toBe(0);
    const listCall = spy.mock.calls[1];
    const url = String(listCall[0]);
    expect(listCall[1].method).toBe("GET");
    expect(listCall[1].headers.Authorization).toBe("Bearer access-1");
    expect(url).toContain("/api/v1/conversations?");
    expect(url).toContain("status=active");
    expect(url).toContain("channel=web");
    expect(url).toContain("page=2");
  });

  it("creates a conversation with lead + channel", async () => {
    const spy = mockFetchOnce(201, {
      success: true,
      data: { id: "conv-1", channel: "web", status: "active" },
    });
    await loginAs(spy);
    const created = await createConversation({ leadId: "lead-1", channel: "web" });
    expect(created.id).toBe("conv-1");
    expect(spy.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(String(spy.mock.calls[1][1].body))).toEqual({
      leadId: "lead-1",
      channel: "web",
    });
  });

  it("refreshes once and retries the original request after a 401", async () => {
    const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url instanceof Request ? url.url : url);
      if (target.endsWith("/api/v1/auth/login")) {
        return jsonResponse(200, loginPayload("access-1"));
      }
      if (target.endsWith("/api/v1/auth/refresh")) {
        return jsonResponse(200, loginPayload("access-2"));
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (auth === "Bearer access-1") {
        return jsonResponse(401, { success: false, error: { message: "stale", code: 401 } });
      }
      return jsonResponse(
        200,
        { success: true, data: { conversations: [], total: 0, page: 1, limit: 20 } }
      );
    });
    vi.stubGlobal("fetch", spy);
    await loginAs(spy);
    const result = await listConversations({});
    expect(result.total).toBe(0);
    // login + stale attempt + refresh + retry: exactly one refresh, no loop.
    expect(spy.mock.calls.filter((c) => String(c[0]).endsWith("/api/v1/auth/refresh"))).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(4);
    const retryAuth = (spy.mock.calls[3][1]?.headers as Record<string, string>)?.Authorization;
    expect(retryAuth).toBe("Bearer access-2");
  });

  it("surfaces 401 without looping when refresh fails", async () => {
    const spy = vi.fn(async (url: string | URL | Request) => {
      const target = String(url instanceof Request ? url.url : url);
      if (target.endsWith("/api/v1/auth/refresh")) {
        return jsonResponse(401, { success: false, error: { message: "expired", code: 401 } });
      }
      return jsonResponse(401, { success: false, error: { message: "expired", code: 401 } });
    });
    vi.stubGlobal("fetch", spy);
    const error = await listConversations({}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("unauthorized");
    expect(spy.mock.calls.filter((c) => String(c[0]).endsWith("/api/v1/auth/refresh"))).toHaveLength(1);
  });

  it("sends a message and unwraps the persisted user/assistant pair", async () => {
    const spy = mockFetchOnce(201, {
      success: true,
      data: {
        conversation: { id: "conv-1" },
        userMessage: { id: "m-1", role: "user", content: "Hi" },
        assistantMessage: { id: "m-2", role: "assistant", content: "Hello" },
        qualification: null,
      },
    });
    await loginAs(spy);
    const result = await sendConversationMessage("conv-1", "Hi");
    expect(result.userMessage.role).toBe("user");
    expect(result.assistantMessage.role).toBe("assistant");
    expect(JSON.parse(String(spy.mock.calls[1][1].body))).toEqual({ content: "Hi" });
  });

  it("fetches detail, messages, state, and qualification by id", async () => {
    const spy = mockFetchOnce(200, { success: true, data: { conversation: { id: "conv-1" } } });
    await loginAs(spy);
    await getConversation("conv-1");
    mockFetchOnce(200, { success: true, data: { messages: [], total: 0, page: 1, limit: 50 } });
    const messages = await getConversationMessages("conv-1", 1, 50);
    expect(messages.total).toBe(0);
    mockFetchOnce(200, { success: true, data: null });
    await expect(getConversationState("conv-1")).resolves.toBeNull();
    mockFetchOnce(200, { success: true, data: { id: "q-1", tier: "HOT", score: 90 } });
    const qual = await getConversationQualification("conv-1");
    expect(qual.tier).toBe("HOT");
  });

  it("completes, abandons, and manually qualifies", async () => {
    const spy = mockFetchOnce(200, { success: true, data: { id: "conv-1", status: "completed" } });
    await loginAs(spy);
    await expect(completeConversation("conv-1")).resolves.toMatchObject({ status: "completed" });
    mockFetchOnce(200, { success: true, data: { id: "conv-1", status: "abandoned" } });
    await expect(abandonConversation("conv-1")).resolves.toMatchObject({ status: "abandoned" });
    mockFetchOnce(201, { success: true, data: { id: "q-1", tier: "WARM" } });
    await expect(qualifyConversation("conv-1")).resolves.toMatchObject({ tier: "WARM" });
  });

  it("checks availability and books meetings with explicit slots", async () => {
    const spy = mockFetchOnce(200, { success: true, data: { available: true } });
    await loginAs(spy);
    await expect(
      getConversationAvailability("conv-1", { start: "2026-09-20T10:00:00Z", end: "2026-09-20T10:30:00Z", timezone: "Asia/Kolkata" })
    ).resolves.toEqual({ available: true });
    mockFetchOnce(201, { success: true, data: { id: "bk-1", meet_url: "https://meet.google.com/x" } });
    const booking = await bookConversationMeeting("conv-1", {
      start: "2026-09-20T10:00:00Z",
      end: "2026-09-20T10:30:00Z",
      timezone: "Asia/Kolkata",
      title: "Intro",
    });
    expect(booking.meet_url).toContain("https://meet.google.com/");
  });

  it("maps backend failures to user-safe kinds (404/409/429/500)", async () => {
    const spy = mockFetchOnce(200, loginPayload());
    await loginAs(spy);
    const cases: Array<[number, string]> = [
      [404, "not-found"],
      [409, "conflict"],
      [429, "rate-limited"],
      [500, "server"],
    ];
    for (const [status, kind] of cases) {
      mockFetchOnce(status, { success: false, error: { message: "backend says no", code: status } });
      const error = await sendConversationMessage("conv-1", "Hi").catch((e) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).kind).toBe(kind);
      expect(String((error as ApiError).message)).not.toContain("SELECT");
    }
  });

  it("throws a network error when fetch rejects", async () => {
    const spy = vi.fn(async () => { throw new TypeError("down"); });
    vi.stubGlobal("fetch", spy);
    await loginAs(spy).catch(() => undefined);
    const error = await listConversations({}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("network");
  });
});
