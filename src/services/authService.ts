/**
 * Phase 11 — first-party authentication service.
 *
 * - bcrypt password hashes (12 rounds); plaintext never stored or logged.
 * - Short-lived HS256 access tokens (server-only secret, iss/aud validated).
 * - Opaque refresh tokens: 256-bit random, SHA-256 hash persisted, HttpOnly
 *   cookie transport, rotation on use, revocation on logout.
 * - All failures use generic messages (no user-enumeration, no leaks).
 */
import bcrypt from 'bcryptjs';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getAuthConfig } from '../config';
import { SafeUser, toSafeUser, User } from '../models/User';
import {
  createSession,
  createUser,
  findSessionByRefreshHash,
  findUserByEmail,
  findUserById,
  markUserLoggedIn,
  revokeSession,
  updateUserName,
} from '../repositories/userRepository';
import { logger } from '../utils/logger';

const BCRYPT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 128;
const MAX_EMAIL_LEN = 255;
const MAX_NAME_LEN = 255;

export interface AuthTokens {
  user: SafeUser;
  accessToken: string;
  accessExpiresAt: string;
}

const authError = (status: number, message: string): any => {
  const err: any = new Error(message);
  err.status = status;
  return err;
};

const base64UrlEncode = (input: string | Buffer): string =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const requireSecret = (): string => {
  const secret = getAuthConfig().jwtSecret;
  if (!secret) throw authError(500, 'Authentication is not configured');
  return secret;
};

export const normalizeEmail = (email: unknown): string | null => {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LEN) return null;
  return EMAIL_RE.test(trimmed) ? trimmed : null;
};

const validatePassword = (password: unknown): string | null => {
  if (typeof password !== 'string') return null;
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) return null;
  return password;
};

/** Mint a short-lived access token for an authenticated user. */
export const signAccessToken = (user: { id: string; email: string }, nowSec = Math.floor(Date.now() / 1000)): string => {
  const cfg = getAuthConfig();
  const secret = requireSecret();
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      iss: cfg.issuer,
      aud: cfg.audience,
      iat: nowSec,
      exp: nowSec + cfg.accessTtlSec,
    })
  );
  const signingInput = `${header}.${payload}`;
  const signature = base64UrlEncode(createHmac('sha256', secret).update(signingInput).digest());
  return `${signingInput}.${signature}`;
};

export interface VerifiedAccessToken {
  userId: string;
  email: string;
}

/** Verify an access token; throws 401 with a generic message on any failure. */
export const verifyAccessToken = (token: string): VerifiedAccessToken => {
  const fail = (): any => authError(401, 'Invalid or expired credentials');
  try {
    const cfg = getAuthConfig();
    const secret = cfg.jwtSecret;
    if (!secret) throw fail();
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw fail();
    const [header, payload, signature] = parts;
    const expected = base64UrlEncode(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
    const actual = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw fail();
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')) as Record<string, unknown>;
    if (decoded['iss'] !== cfg.issuer || decoded['aud'] !== cfg.audience) throw fail();
    if (typeof decoded['sub'] !== 'string' || decoded['sub'].length === 0) throw fail();
    if (typeof decoded['exp'] !== 'number' || decoded['exp'] * 1000 <= Date.now()) throw fail();
    return { userId: decoded['sub'] as string, email: typeof decoded['email'] === 'string' ? (decoded['email'] as string) : '' };
  } catch (err: any) {
    if (err && typeof err.status === 'number') throw err;
    throw fail();
  }
};

const mintRefreshToken = (): { token: string; hash: string; expiresAt: string } => {
  const cfg = getAuthConfig();
  const token = randomBytes(32).toString('hex');
  const hash = createHmac('sha256', cfg.jwtSecret || 'ephemeral').update(token).digest('hex');
  // NOTE: when no secret is configured, register/login already fail before
  // reaching here; the fallback avoids a crash in unreachable paths.
  const expiresAt = new Date(Date.now() + cfg.refreshTtlSec * 1000).toISOString();
  return { token, hash, expiresAt };
};

const issueSession = async (
  user: User
): Promise<{ user: SafeUser; accessToken: string; accessExpiresAt: string; refreshToken: string; refreshExpiresAt: string }> => {
  const cfg = getAuthConfig();
  const accessToken = signAccessToken({ id: user.id, email: user.email });
  const accessExpiresAt = new Date(Date.now() + cfg.accessTtlSec * 1000).toISOString();
  const refresh = mintRefreshToken();
  await createSession({ user_id: user.id, refresh_hash: refresh.hash, expires_at: refresh.expiresAt });
  await markUserLoggedIn(user.id);
  logger.info('User session issued', { userId: user.id });
  return {
    user: toSafeUser(user),
    accessToken,
    accessExpiresAt,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
};

export const registerUser = async (input: {
  email: unknown;
  password: unknown;
  name?: unknown;
}): Promise<{ user: SafeUser; accessToken: string; accessExpiresAt: string; refreshToken: string; refreshExpiresAt: string }> => {
  if (!getAuthConfig().jwtSecret) throw authError(500, 'Authentication is not configured');
  const email = normalizeEmail(input.email);
  if (!email) throw authError(400, 'A valid email address is required');
  const password = validatePassword(input.password);
  if (!password) throw authError(400, 'Password must be between 8 and 128 characters');
  const name =
    typeof input.name === 'string' && input.name.trim().length > 0
      ? input.name.trim().slice(0, MAX_NAME_LEN)
      : null;
  const existing = await findUserByEmail(email);
  if (existing) throw authError(409, 'An account with this email already exists');
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  // Phase 20 — public registration never mints administrators: every new
  // internal user starts as OPERATOR unless the deployer explicitly named
  // this address BOOTSTRAP_ADMIN_EMAIL (documented bootstrap mechanism).
  const bootstrap = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const role = bootstrap.length > 0 && bootstrap === email ? 'ADMIN' : 'OPERATOR';
  try {
    const user = await createUser({ email, password_hash: passwordHash, name, role });
    return issueSession(user);
  } catch (err: any) {
    // Unique-violation race between the check and the insert.
    if (err && (err.code === '23505' || /duplicate|unique/i.test(err.message || ''))) {
      throw authError(409, 'An account with this email already exists');
    }
    throw err;
  }
};

export const loginUser = async (input: {
  email: unknown;
  password: unknown;
}): Promise<{ user: SafeUser; accessToken: string; accessExpiresAt: string; refreshToken: string; refreshExpiresAt: string }> => {
  if (!getAuthConfig().jwtSecret) throw authError(500, 'Authentication is not configured');
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : null;
  if (!email || !password) throw authError(400, 'Email and password are required');
  const user = await findUserByEmail(email);
  // Generic message either way: no user enumeration.
  if (!user || user.status !== 'active') throw authError(401, 'Invalid email or password');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw authError(401, 'Invalid email or password');
  return issueSession(user);
};

const hashRefreshToken = (token: string): string => {
  const cfg = getAuthConfig();
  return createHmac('sha256', cfg.jwtSecret || 'ephemeral').update(token).digest('hex');
};

/** Rotate a refresh token: revoke the presented one, issue a fresh session. */
export const refreshSession = async (
  refreshToken: string | null | undefined
): Promise<{ user: SafeUser; accessToken: string; accessExpiresAt: string; refreshToken: string; refreshExpiresAt: string }> => {
  if (!getAuthConfig().jwtSecret) throw authError(401, 'Invalid or expired credentials');
  if (!refreshToken || typeof refreshToken !== 'string') throw authError(401, 'Invalid or expired credentials');
  const session = await findSessionByRefreshHash(hashRefreshToken(refreshToken));
  if (!session || session.revoked_at) throw authError(401, 'Invalid or expired credentials');
  if (new Date(session.expires_at).getTime() <= Date.now()) throw authError(401, 'Invalid or expired credentials');
  const user = await findUserById(session.user_id);
  if (!user || user.status !== 'active') throw authError(401, 'Invalid or expired credentials');
  await revokeSession(session.id);
  return issueSession(user);
};

export const logoutSession = async (refreshToken: string | null | undefined): Promise<void> => {
  try {
    if (!refreshToken || typeof refreshToken !== 'string') return;
    const session = await findSessionByRefreshHash(hashRefreshToken(refreshToken));
    if (session && !session.revoked_at) await revokeSession(session.id);
  } catch (err: any) {
    logger.error('Logout failed safely', { error: err?.message });
  }
};

export const getAuthenticatedUser = async (userId: string): Promise<SafeUser> => {
  const user = await findUserById(userId);
  if (!user || user.status !== 'active') throw authError(401, 'Invalid or expired credentials');
  return toSafeUser(user);
};

/**
 * Phase 17 — rename the authenticated user. Only the display name is
 * writable: id/email/password_hash/status/ownership can never change here
 * (the repository updates exactly one column). Empty names are rejected;
 * overlong names are trimmed to the column-safe limit.
 */
export const renameAuthenticatedUser = async (
  userId: string,
  name: unknown
): Promise<SafeUser> => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length === 0) throw authError(400, 'Name must not be empty');
  if (trimmed.length > MAX_NAME_LEN) throw authError(400, 'Name is too long');
  const existing = await findUserById(userId);
  if (!existing || existing.status !== 'active') throw authError(401, 'Invalid or expired credentials');
  const updated = await updateUserName(userId, trimmed);
  if (!updated) throw authError(401, 'Invalid or expired credentials');
  return toSafeUser(updated);
};
