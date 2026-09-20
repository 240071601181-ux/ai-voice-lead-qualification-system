/**
 * Phase 20 — customer access domain (admin/customer separation).
 *
 * Customers are external leads/conversations, never internal users. Access
 * is granted per conversation via opaque bearer tokens and sessions:
 * - customer_access_tokens: issued by an internal user, redeemed once into
 *   a session. Only HMAC hashes persist — raw tokens never touch the DB.
 * - customer_sessions: HttpOnly-cookie sessions scoped to exactly one
 *   conversation. Revocable, expiring, last-seen tracked.
 */
export interface CustomerAccessToken {
  id: string; // UUID
  conversation_id: string; // UUID
  token_hash: string;
  expires_at: string; // ISO timestamp
  revoked_at?: string | null;
  created_at: string;
}

export interface CustomerSession {
  id: string; // UUID
  conversation_id: string; // UUID
  session_hash: string;
  expires_at: string; // ISO timestamp
  revoked_at?: string | null;
  created_at: string;
  last_seen_at: string;
}
