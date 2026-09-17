/**
 * Phase 14C-AUTH-FIX — UI-only demo session for the MadVoice shell.
 *
 * The live shell (`layouts/AppLayout`) never had an auth state: RequireAuth
 * was a passthrough, login buttons only navigated, and ProfilePage logout
 * only showed a toast. This module is the single demo-session seam:
 * login establishes it, RequireAuth enforces it, logout clears it.
 *
 * UI-ONLY: persisted to localStorage so refresh keeps a logged-IN session,
 * but logout removes it so refresh can never restore a logged-OUT session.
 * No backend calls, no credential verification. Real auth lands later and
 * replaces this module's consumers (guards + auth pages + profile logout).
 */

export interface DemoSession {
  email: string;
  name: string;
  loginAt: string;
}

const DEMO_SESSION_KEY = "madvoice-demo-session";

export function getDemoSession(): DemoSession | null {
  try {
    const raw = localStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof (parsed as DemoSession).email === "string") {
      return parsed as DemoSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function isDemoAuthenticated(): boolean {
  return getDemoSession() !== null;
}

/** Establish the demo session (demo account: Maya Singh / Acme Cargo). */
export function demoLogin(email: string): DemoSession {
  const session: DemoSession = {
    email,
    name: "Maya Singh",
    loginAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable (private mode): session lasts for this page load.
  }
  return session;
}

/** Clear the demo session so refresh cannot restore the logged-in state. */
export function demoLogout(): void {
  try {
    localStorage.removeItem(DEMO_SESSION_KEY);
  } catch {
    // Ignore storage errors; best effort.
  }
  // Also drop the platform preview token mirror if present, so a stale
  // Manus session can't re-establish UI state after demo logout.
  try {
    sessionStorage.removeItem("manus-cookie");
  } catch {
    // Ignore storage errors; best effort.
  }
  // Phase 10: drop the tab-scoped chat token too — a new login must not
  // inherit the previous session's conversation credential.
  try {
    sessionStorage.removeItem("chat-jwt");
  } catch {
    // Ignore storage errors; best effort.
  }
}
