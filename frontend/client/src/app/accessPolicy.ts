/** Canonical client-side view of the backend's internal role values. */
export const INTERNAL_ROLES = ["ADMIN", "USER"] as const;
export type InternalRole = (typeof INTERNAL_ROLES)[number];

export function isInternalRole(value: unknown): value is InternalRole {
  return value === "ADMIN" || value === "USER";
}

const ADMIN_ONLY_PATHS = ["/ai-agent", "/knowledge/ingest", "/settings"] as const;

export function isAdminOnlyPath(path: string): boolean {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return ADMIN_ONLY_PATHS.some(
    (restricted) => normalized === restricted || normalized.startsWith(`${restricted}/`)
  );
}

/** One policy used for direct routes and every navigation destination. */
export function canAccessPath(role: unknown, path: string): boolean {
  if (!isInternalRole(role)) return false;
  return role === "ADMIN" || !isAdminOnlyPath(path);
}
