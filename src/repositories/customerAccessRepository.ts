import { pool } from '../database';
import { CustomerAccessToken, CustomerSession } from '../models/CustomerAccess';

/**
 * Phase 20 — customer access persistence (parameterized SQL only).
 *
 * Only token/session HASHES are stored. Lookup helpers return rows only
 * when the grant is live (unexpired and unrevoked); expired-or-revoked
 * grants resolve to null so every caller fails closed with 401.
 */

export const createAccessToken = async (input: {
  conversation_id: string;
  token_hash: string;
  expires_at: string;
}): Promise<CustomerAccessToken> => {
  const res = await pool.query(
    `INSERT INTO customer_access_tokens (conversation_id, token_hash, expires_at)
     VALUES ($1, $2, $3) RETURNING *`,
    [input.conversation_id, input.token_hash, input.expires_at]
  );
  return res.rows[0];
};

export const findLiveAccessToken = async (
  tokenHash: string
): Promise<CustomerAccessToken | null> => {
  const res = await pool.query(
    `SELECT * FROM customer_access_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [tokenHash]
  );
  return res.rows[0] || null;
};

export const revokeAccessTokensForConversation = async (
  conversationId: string
): Promise<number> => {
  const res = await pool.query(
    `UPDATE customer_access_tokens SET revoked_at = NOW()
      WHERE conversation_id = $1 AND revoked_at IS NULL RETURNING id`,
    [conversationId]
  );
  return res.rows.length;
};

export const createCustomerSession = async (input: {
  conversation_id: string;
  session_hash: string;
  expires_at: string;
}): Promise<CustomerSession> => {
  const res = await pool.query(
    `INSERT INTO customer_sessions (conversation_id, session_hash, expires_at)
     VALUES ($1, $2, $3) RETURNING *`,
    [input.conversation_id, input.session_hash, input.expires_at]
  );
  return res.rows[0];
};

export const findLiveCustomerSession = async (
  sessionHash: string
): Promise<CustomerSession | null> => {
  const res = await pool.query(
    `SELECT * FROM customer_sessions
      WHERE session_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [sessionHash]
  );
  return res.rows[0] || null;
};

export const touchCustomerSession = async (id: string): Promise<void> => {
  await pool.query('UPDATE customer_sessions SET last_seen_at = NOW() WHERE id = $1', [id]);
};

export const revokeCustomerSession = async (id: string): Promise<void> => {
  await pool.query('UPDATE customer_sessions SET revoked_at = NOW() WHERE id = $1', [id]);
};

export const revokeCustomerSessionsForConversation = async (
  conversationId: string
): Promise<number> => {
  const res = await pool.query(
    `UPDATE customer_sessions SET revoked_at = NOW()
      WHERE conversation_id = $1 AND revoked_at IS NULL RETURNING id`,
    [conversationId]
  );
  return res.rows.length;
};
