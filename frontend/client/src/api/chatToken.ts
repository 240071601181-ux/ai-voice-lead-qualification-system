/**
 * Phase 9 — Chat JWT token store for the text-conversation API.
 *
 * The Express conversation API authenticates with a `CHAT_JWT_SECRET`-signed
 * Bearer token (`requireConversationAuth`), which is unrelated to the
 * platform session cookie. There is no token-issuance endpoint by design, so
 * for development the operator pastes a token minted with backend access
 * (see docs/frontend-text-conversation.md) into the Conversations UI once;
 * it is kept in `sessionStorage` for the tab lifetime only.
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

/** Persist a pasted token for this tab. Throws on empty input. */
export function setChatToken(token: string): void {
  const value = (token ?? "").trim();
  if (!value) throw new Error("Token must not be empty.");
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
