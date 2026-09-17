/**
 * Phase 11 — user identity (minimal first-party auth).
 * Password hashes never leave the backend; API layers use SafeUser.
 */
export interface User {
  id: string; // UUID
  email: string;
  password_hash: string;
  name?: string | null;
  status: 'active' | 'disabled';
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SafeUser {
  id: string;
  email: string;
  name?: string | null;
  status: 'active' | 'disabled';
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
}

export const toSafeUser = (user: User): SafeUser => ({
  id: user.id,
  email: user.email,
  name: user.name ?? null,
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
