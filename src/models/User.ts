/**
 * Phase 11 — user identity (minimal first-party auth).
 * Phase 20 — internal role model (ADMIN | OPERATOR). Customers are NEVER
 * rows here: they are external leads/conversations behind customer tokens.
 * Password hashes never leave the backend; API layers use SafeUser.
 */
export type InternalRole = 'ADMIN' | 'OPERATOR';

export interface User {
  id: string; // UUID
  email: string;
  password_hash: string;
  name?: string | null;
  role?: InternalRole | string | null;
  status: 'active' | 'disabled';
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SafeUser {
  id: string;
  email: string;
  name?: string | null;
  role: InternalRole;
  status: 'active' | 'disabled';
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Phase 20 — normalize any stored value to a known internal role.
 * Unknown/missing values (e.g. rows created before migration 018) safely
 * resolve to OPERATOR: least privilege, never a silent ADMIN.
 */
export const normalizeRole = (value: unknown): InternalRole =>
  value === 'ADMIN' ? 'ADMIN' : 'OPERATOR';

export const toSafeUser = (user: User): SafeUser => ({
  id: user.id,
  email: user.email,
  name: user.name ?? null,
  role: normalizeRole(user.role),
  status: user.status,
  last_login_at: user.last_login_at ?? null,
  created_at: user.created_at,
  updated_at: user.updated_at,
});

export interface UserSession {
  id: string; // UUID
  user_id: string;
  refresh_hash: string;
  expires_at: string;
  revoked_at?: string | null;
  created_at: string;
}
