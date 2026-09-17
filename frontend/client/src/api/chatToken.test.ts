/**
 * Phase 10 — Chat token store tests (node-safe, no DOM).
 *
 * Covers persistence semantics (sessionStorage only — never localStorage),
 * shape/expiry validation, the auth header, and single-shot 401 handling.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearChatToken,
  getChatAuthHeader,
  getChatToken,
  handleChatUnauthorizedOnce,
  isChatTokenExpired,
  isJwtShaped,
  setChatToken,
} from "@/api/chatToken";

const b64 = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const fakeJwt = (payload: Record<string, unknown>): string =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature`;

const freshToken = () =>
  fakeJwt({ sub: "operator-1", iat: 1_700_000_000, exp: 9_999_999_999 });
const expiredToken = () => fakeJwt({ sub: "operator-1", iat: 1, exp: 2 });

describe("chat token store", () => {
  const sessionMem = new Map<string, string>();
  const localWrites: string[] = [];

  beforeEach(() => {
    sessionMem.clear();
    localWrites.length = 0;
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => (sessionMem.has(key) ? sessionMem.get(key)! : null),
      setItem: (key: string, value: string) => { sessionMem.set(key, String(value)); },
      removeItem: (key: string) => { sessionMem.delete(key); },
      clear: () => { sessionMem.clear(); },
    });
    // localStorage must never receive the token: record any write attempt.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: (key: string) => { localWrites.push(key); },
      removeItem: () => undefined,
      clear: () => undefined,
    });
  });

  it("persists to sessionStorage only and round-trips the header", () => {
    expect(getChatToken()).toBeNull();
    expect(getChatAuthHeader()).toEqual({});
    setChatToken(freshToken());
    expect(getChatToken()).toBe(freshToken());
    expect(getChatAuthHeader()).toEqual({ Authorization: `Bearer ${freshToken()}` });
    expect(localWrites).toEqual([]);
    clearChatToken();
    expect(getChatToken()).toBeNull();
  });

  it("rejects empty, malformed, and expired tokens without storing", () => {
    expect(() => setChatToken("   ")).toThrow("must not be empty");
    expect(() => setChatToken("not-a-jwt")).toThrow("three-part JWT");
    expect(() => setChatToken(expiredToken())).toThrow("already expired");
    expect(getChatToken()).toBeNull();
    expect(isJwtShaped("a.b.c")).toBe(false);
    expect(isJwtShaped(freshToken())).toBe(true);
    expect(isChatTokenExpired(expiredToken())).toBe(true);
    expect(isChatTokenExpired(freshToken())).toBe(false);
  });

  it("clears a rejected token exactly once (no refresh loop)", () => {
    expect(handleChatUnauthorizedOnce()).toBe(false);
    setChatToken(freshToken());
    expect(handleChatUnauthorizedOnce()).toBe(true);
    expect(getChatToken()).toBeNull();
    expect(handleChatUnauthorizedOnce()).toBe(false);
  });
});
