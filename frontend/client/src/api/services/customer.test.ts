/**
 * Phase 20 — customer API service tests.
 *
 * The customer client authenticates with the HttpOnly session cookie only:
 * these calls work with NO internal session (no login, no pasted tokens),
 * send JSON with application/json, carry an Idempotency-Key on sends, and
 * allow the slow model budget on message turns.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { frontendEnv } from "@/api/env";
import {
  getCustomerConversation,
  getCustomerMessages,
  redeemCustomerSession,
  sendCustomerMessage,
} from "@/api/services/customer";

const JSON_HEADERS = { "content-type": "application/json" };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

describe("customer API service", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
  });

  it("redeems a share token without any internal session", async () => {
    const spy = vi.fn(async () =>
      jsonResponse(201, {
        success: true,
        data: { conversation: { id: "conv-1", status: "active", channel: "web" }, expiresAt: "2026-10-01T00:00:00.000Z" },
      })
    );
    vi.stubGlobal("fetch", spy);
    const result = await redeemCustomerSession("tok-abc");
    expect(result.conversation.id).toBe("conv-1");
    const [, init] = spy.mock.calls[0] as [unknown, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    // No internal Authorization header is minted by this client.
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({ accessToken: "tok-abc" });
  });

  it("sends the idempotency key and JSON body on customer messages", async () => {
    const spy = vi.fn(async () =>
      jsonResponse(201, {
        success: true,
        data: {
          conversation: { id: "conv-1" },
          userMessage: { id: "m-1", role: "user", content: "Hi" },
          assistantMessage: { id: "m-2", role: "assistant", content: "Hello" },
          qualification: null,
        },
      })
    );
    vi.stubGlobal("fetch", spy);
    await sendCustomerMessage("Hi", "key-1");
    const [, init] = spy.mock.calls[0] as [unknown, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ content: "Hi" });
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-1");
  });

  it("reads the own conversation and messages with credentials", async () => {
    const spy = vi.fn(async (url: unknown) => {
      const target = String(url);
      if (target.endsWith("/api/v1/customer/conversation")) {
        return jsonResponse(200, { success: true, data: { id: "conv-1", status: "active", channel: "web" } });
      }
      return jsonResponse(200, { success: true, data: { messages: [], total: 0, page: 1, limit: 50 } });
    });
    vi.stubGlobal("fetch", spy);
    await expect(getCustomerConversation()).resolves.toMatchObject({ id: "conv-1" });
    await expect(getCustomerMessages()).resolves.toMatchObject({ total: 0 });
    for (const [, init] of spy.mock.calls as Array<[unknown, RequestInit]>) {
      expect(init.credentials).toBe("include");
    }
  });
});
