/**
 * Phase 11 — Real backend session for the SPA (replaces demoAuth + chat-token paste).
 *
 * Architecture:
 * - Access token: short-lived JWT, kept in MODULE MEMORY only (never
 *   localStorage/sessionStorage/source). Lost on reload by design.
 * - Refresh: HttpOnly cookie (`mad_rt`) managed by the backend; the browser
 *   sends it automatically (httpClient uses credentials: "include").
 * - Boot/restore: `restoreSession()` tries refresh-once; success reseeds the
 *   in-memory token, failure means logged-out (no loops).
 * - API calls: `authedRequest()` runs with the current token; on 401 it
 *   refreshes exactly once and retries the original request once, then
 *   clears the session and rethrows (caller redirects to /login).
 *
 * No passwords, hashes, secrets, or refresh tokens are readable here — the
 * refresh credential never leaves its HttpOnly cookie.
 */
import { httpClient } from "./httpClient";
import { ApiError } from "./errors";

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
}

interface AuthPayload {
  user: SessionUser;
  accessToken: string;
  accessExpiresAt: string;
}

let accessToken: string | null = null;
let currentUser: SessionUser | null = null;
let refreshInFlight: Promise<boolean> | null = null;

/** Test-only hook: reseed/clear module state without touching storage. */
export function resetSessionForTests(): void {
  accessToken = null;
  currentUser = null;
  refreshInFlight = null;
}

/** Current in-memory user (null when logged out or not yet restored). */
export function getSessionUser(): SessionUser | null {
  return currentUser;
}

/** Current in-memory access token (null when logged out). Never logged. */
export function getAccessToken(): string | null {
  return accessToken;
}

function applyPayload(payload: AuthPayload): SessionUser {
  accessToken = payload.accessToken;
  currentUser = payload.user;
  return payload.user;
}

export async function register(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<SessionUser> {
  const payload = await httpClient.post<AuthPayload>("/api/v1/auth/register", input);
  return applyPayload(payload);
}

export async function login(input: { email: string; password: string }): Promise<SessionUser> {
  const payload = await httpClient.post<AuthPayload>("/api/v1/auth/login", input);
  return applyPayload(payload);
}

export async function logout(): Promise<void> {
  try {
    await httpClient.post<{ loggedOut: boolean }>("/api/v1/auth/logout", {});
  } catch {
    // Best effort: local state is cleared regardless.
  } finally {
    accessToken = null;
    currentUser = null;
    refreshInFlight = null;
  }
}

/**
 * Single refresh attempt shared across concurrent callers. Returns true when
 * a fresh access token was obtained.
 */
export function refreshSessionOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const payload = await httpClient.post<AuthPayload>("/api/v1/auth/refresh", {});
        applyPayload(payload);
        return true;
      } catch {
        accessToken = null;
        currentUser = null;
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/** Boot-time restoration: exactly one refresh attempt, never throws. */
export async function restoreSession(): Promise<SessionUser | null> {
  const ok = await refreshSessionOnce();
  return ok ? currentUser : null;
}

/**
 * Phase 17 — persist the display name (PATCH /api/v1/auth/me, name only).
 * The backend returns the updated user (no tokens); the in-memory session
 * is reseeded so sidebar/avatar/profile update immediately and survive
 * reloads via the normal refresh flow.
 */
export async function updateProfileName(name: string): Promise<SessionUser> {
  return authedRequest(async (headers) => {
    const user = await httpClient.patch<SessionUser>("/api/v1/auth/me", { name }, { headers });
    currentUser = user;
    return user;
  });
}

/** `Authorization` header for backend calls, else `{}`. */
export function getAuthHeader(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/**
 * Run a backend call with the session token; on 401 refresh exactly once
 * and retry the original request once. Used by authenticated services
 * (conversations). No infinite loops: at most two attempts total.
 */
export async function authedRequest<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  try {
    return await fn(getAuthHeader());
  } catch (error) {
    if (!(error instanceof ApiError) || error.kind !== "unauthorized") throw error;
    const refreshed = await refreshSessionOnce();
    if (!refreshed) throw error;
    return fn(getAuthHeader());
  }
}
