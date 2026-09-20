/**
 * Phase 20 — shared internal-auth fixture for backend route tests.
 *
 * Admin routers require an authenticated internal user (requireAuth) with a
 * sufficient role (requireRole). Suites that call protected routes through
 * supertest use this helper to:
 * 1. configure AUTH_JWT_SECRET for the suite (save/restore handled here),
 * 2. serve an ADMIN user row for `SELECT * FROM users WHERE ...` inside
 *    their bespoke pool mocks,
 * 3. mint a real Bearer access token for request headers.
 *
 * Usage inside a suite's pool mock implementation, before generic fallbacks:
 *   if (sql.includes('FROM users WHERE')) return { rows: [internalAuth.adminUser] };
 * Requests add `.set('Authorization', internalAuth.bearer())`.
 */
import { signAccessToken } from '../../services/authService';

export const INTERNAL_AUTH_SECRET = 'phase20-internal-auth-test-secret';

export const adminUser = {
  id: 'admin-user-1',
  email: 'admin@example.com',
  password_hash: 'hashed-test-only',
  name: 'Test Admin',
  role: 'ADMIN',
  status: 'active',
  last_login_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const operatorUser = {
  ...adminUser,
  id: 'operator-user-1',
  email: 'operator@example.com',
  name: 'Test Operator',
  role: 'OPERATOR',
};

/** Install the suite secret; returns a restore function for afterAll. */
export const useInternalAuthSecret = (): (() => void) => {
  const saved = process.env.AUTH_JWT_SECRET;
  process.env.AUTH_JWT_SECRET = INTERNAL_AUTH_SECRET;
  return () => {
    if (saved === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = saved;
  };
};

export const bearerFor = (user: { id: string; email: string } = adminUser): string =>
  `Bearer ${signAccessToken({ id: user.id, email: user.email })}`;
