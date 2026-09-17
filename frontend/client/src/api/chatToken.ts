/**
 * Phase 9 — Chat JWT token store for the text-conversation API.
 * Phase 10 — hardened: shape + expiry pre-checks, single-shot 401 handling.
 *
 * The Express conversation API authenticates with a CHAT_JWT_SECRET-signed
 * Bearer token (`requireConversationAuth`), which is unrelated to the
 * platform session cookie. There is no token-issuance endpoint by design
 * (the backend has no user store to bind issuance to — minting would be
 * security theater), so for development the operator pastes a token minted
 * with backend access (see docs/frontend-text-conversation.md) into the
 * Conversations UI once; it is kept in `sessionStorage` for the tab lifetime
 * only.
 *
 * Never log the returned value. Never hardcode a token or secret here, and
 * never expose CHAT_JWT_SECRET through VITE_ variables (they ship to the
 * browser). Production issuance remains an explicit open item (see docs).
 */

const CHAT_TOKEN_KEY = "chat-jwt";

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("utf-8");
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Structural check only (three JWT segments + JSON payload). No signature verification here. */
export function isJwtShaped(token: string): boolean {
  return decodePayload((token ?? "").trim()) !== null;
}

/** True when the token carries an `exp` claim already in the past. */
export function isChatTokenExpired(token: string, nowMs = Date.now()): boolean {
  const payload = decodePayload((token ?? "").trim());
  const exp = payload?.exp;
  return typeof exp === "number" && exp * 1000 <= nowMs;
}

/** Raw token previously saved via the Conversations connect dialog, if any. */
export function getChatToken(): string | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(CHAT_TOKEN_KEY);
    const token = (raw ?? "").trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Persist a pasted token for this tab. Rejects empty, malformed, or
 * already-expired input with a clear message (signature verification stays
 * backend-side on every request).
 */
export function setChatToken(token: string): void {
  const value = (token ?? "").trim();
  if (!value) throw new Error("Token must not be empty.");
  if (!isJwtShaped(value)) {
    throw new Error("That doesn't look like a chat token (expected a three-part JWT).");
  }
  if (isChatTokenExpired(value)) {
    throw new Error("That token is already expired. Mint a fresh one and try again.");
  }
  storage()?.setItem(CHAT_TOKEN_KEY, value);
}

/** Forget the saved token (e.g. after repeated 401s). */
export function clearChatToken(): void {
  try {
    storage()?.removeItem(CHAT_TOKEN_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

/** `Authorization` header override for conversation API calls, else `{}`. */
export function getChatAuthHeader(): Record<string, string> {
  const token = getChatToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Single-shot 401 handling: clears a saved token the first time the backend
 * rejects it, so the UI flips to the connect state instead of failing every
 * request in a loop. Returns true when a token was cleared (caller should
 * prompt reconnect), false when no token was saved (caller shows the plain
 * connect hint). Never throws.
 */
export function handleChatUnauthorizedOnce(): boolean {
  try {
    if (!getChatToken()) return false;
    clearChatToken();
    return true;
  } catch {
    return false;
  }
}
