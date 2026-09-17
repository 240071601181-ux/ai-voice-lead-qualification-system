/**
 * Phase 9 — Conversation API service tests.
 *
 * Mocks the network boundary (global fetch) only: asserts request paths,
 * methods, bodies, the CHAT_JWT Authorization header, envelope unwrapping,
 * and user-safe error kinds. No business logic is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/errors";
import { frontendEnv } from "@/api/env";
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

describe("conversations API service", () => {
  const mem = new Map<string, string>();

  beforeEach(() => {
    vi.unstubAllGlobals();
    mem.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
      setItem: (key: string, value: string) => { mem.set(key, String(value)); },
      removeItem: (key: string) => { mem.delete(key); },
      clear: () => { mem.clear(); },
    });
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:3000");
    // frontendEnv is captured at import time, so point it at the test backend directly.
    frontendEnv.apiBaseUrl = "http://localhost:3000";
  });

  it("lists conversations with filters and pagination", async () => {
    const spy = mockFetchOnce(200, {
      success: true,
      data: { conversations: [], total: 0, page: 2, limit: 20 },
    });
    const result = await listConversations({ status: "active", channel: "web", page: 2, limit: 20 });
    expect(result.total).toBe(0);
    const url = String(spy.mock.calls[0][0]);
    expect(spy.mock.calls[0][1].method).toBe("GET");
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
    const created = await createConversation({ leadId: "lead-1", channel: "web" });
    expect(created.id).toBe("conv-1");
    expect(spy.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(spy.mock.calls[0][1].body))).toEqual({
      leadId: "lead-1",
      channel: "web",
    });
  });

  it("sends the saved chat token as the Authorization header", async () => {
    mem.set("chat-jwt", "tok-123");
    const spy = mockFetchOnce(200, { success: true, data: { conversations: [], total: 0, page: 1, limit: 20 } });
    await listConversations({});
    expect(spy.mock.calls[0][1].headers.Authorization).toBe("Bearer tok-123");
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
    const result = await sendConversationMessage("conv-1", "Hi");
    expect(result.userMessage.role).toBe("user");
    expect(result.assistantMessage.role).toBe("assistant");
    expect(JSON.parse(String(spy.mock.calls[0][1].body))).toEqual({ content: "Hi" });
  });

  it("fetches detail, messages, state, and qualification by id", async () => {
    mockFetchOnce(200, { success: true, data: { conversation: { id: "conv-1" } } });
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
    mockFetchOnce(200, { success: true, data: { id: "conv-1", status: "completed" } });
    await expect(completeConversation("conv-1")).resolves.toMatchObject({ status: "completed" });
    mockFetchOnce(200, { success: true, data: { id: "conv-1", status: "abandoned" } });
    await expect(abandonConversation("conv-1")).resolves.toMatchObject({ status: "abandoned" });
    mockFetchOnce(201, { success: true, data: { id: "q-1", tier: "WARM" } });
    await expect(qualifyConversation("conv-1")).resolves.toMatchObject({ tier: "WARM" });
  });

  it("checks availability and books meetings with explicit slots", async () => {
    mockFetchOnce(200, { success: true, data: { available: true } });
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

  it("maps backend failures to user-safe kinds (401/404/409/429/500)", async () => {
    const cases: Array<[number, string]> = [
      [401, "unauthorized"],
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
      // Backend internals never surface beyond the public message.
      expect(String((error as ApiError).message)).not.toContain("SELECT");
    }
  });

  it("throws a network error when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    const error = await listConversations({}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("network");
  });
});
