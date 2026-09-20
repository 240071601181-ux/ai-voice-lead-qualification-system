/**
 * Phase 11 — user + session persistence (parameterized SQL only).
 */
import { pool } from '../database';
import { InternalRole, User, UserSession } from '../models/User';

export const createUser = async (input: {
  email: string;
  password_hash: string;
  name?: string | null;
  role?: InternalRole;
}): Promise<User> => {
  const res = await pool.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.email, input.password_hash, input.name || null, input.role || 'OPERATOR']
  );
  return res.rows[0];
};

export const findUserByEmail = async (email: string): Promise<User | null> => {
  const res = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  return res.rows[0] || null;
};

export const findUserById = async (id: string): Promise<User | null> => {
  const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return res.rows[0] || null;
};

export const markUserLoggedIn = async (id: string): Promise<void> => {
  await pool.query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [id]);
};

/**
 * Phase 17 — the ONLY profile mutation exposed to users: display name.
 * Protected fields (id, email, password_hash, status, ownership, security
 * columns) are never writable through this path by construction.
 */
export const updateUserName = async (id: string, name: string): Promise<User | null> => {
  const res = await pool.query(
    'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [name, id]
  );
  return res.rows[0] || null;
};

export const createSession = async (input: {
  user_id: string;
  refresh_hash: string;
  expires_at: string;
}): Promise<UserSession> => {
  const res = await pool.query(
    `INSERT INTO user_sessions (user_id, refresh_hash, expires_at)
     VALUES ($1, $2, $3) RETURNING *`,
    [input.user_id, input.refresh_hash, input.expires_at]
  );
  return res.rows[0];
};

export const findSessionByRefreshHash = async (
  refreshHash: string
): Promise<UserSession | null> => {
  const res = await pool.query('SELECT * FROM user_sessions WHERE refresh_hash = $1', [refreshHash]);
  return res.rows[0] || null;
};

export const revokeSession = async (id: string): Promise<void> => {
  await pool.query('UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1', [id]);
};

export const revokeAllSessionsForUser = async (userId: string): Promise<void> => {
  await pool.query('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [
    userId,
  ]);
};

export const deleteExpiredSessions = async (): Promise<number> => {
  const res = await pool.query('DELETE FROM user_sessions WHERE expires_at < NOW() RETURNING id');
  return res.rows.length;
};
