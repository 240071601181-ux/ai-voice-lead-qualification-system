/**
 * Phase 17 — Authenticated-user display helpers (no React).
 *
 * Single source for user identity presentation: avatar initials, display
 * name, and truthful fallbacks. Never fabricates names, roles, or
 * workspaces — callers render "Not set" style fallbacks instead.
 */

export const UNNAMED_USER_COPY = "Unnamed User";
export const MISSING_EMAIL_COPY = "—";
export const ROLE_UNSET_COPY = "Role not set";
export const WORKSPACE_UNSET_COPY = "Workspace not set";

/**
 * Avatar initials: the FIRST TWO LETTERS of the trimmed display name,
 * uppercased (Santhosh → SA). Single-character names yield one letter;
 * empty/missing names yield "U". Never hardcoded per-user.
 */
export function userInitials(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  if (clean.length === 0) return "U";
  return clean.slice(0, 2).toUpperCase();
}

/** Display name or the truthful fallback (never a UUID, never invented). */
export function displayUserName(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  return clean.length > 0 ? clean : UNNAMED_USER_COPY;
}
