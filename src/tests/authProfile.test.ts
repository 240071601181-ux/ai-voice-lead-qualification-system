/**
 * Phase 17 — profile rename endpoint (PATCH /api/v1/auth/me).
 *
 * Proves ONLY the display name is writable: id/email/password_hash/status
 * can never change through this route, empty/overlong names are rejected,
 * unauthenticated callers get 401, and the change persists (visible via
 * GET /me). Dummy fixtures only.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signAccessToken } from '../services/authService';
import { resetLoginRateLimitsForTests } from '../middleware/loginRateLimit';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const AUTH_SECRET = 'phase17-profile-test-secret';

const userA = {
  id: 'user-aaa',
  email: 'a@example.com',
  password_hash: 'hashed',
  name: 'Original Name',
  status: 'active',
  last_login_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('profile rename (Phase 17)', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ['AUTH_JWT_SECRET', 'AUTH_LOGIN_MAX_ATTEMPTS', 'AUTH_LOGIN_WINDOW_MS']) {
      savedEnv[key] = process.env[key];
    }
    process.env.AUTH_JWT_SECRET = AUTH_SECRET;
    process.env.AUTH_LOGIN_MAX_ATTEMPTS = '1000';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetLoginRateLimitsForTests();
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM users WHERE id')) {
        return { rows: params[0] === 'user-aaa' ? [{ ...userA }] : [] };
      }
      if (sql.startsWith('UPDATE users SET name')) {
        return { rows: [{ ...userA, name: params[0] }] };
      }
      return { rows: [] };
    });
  });

  const token = () => signAccessToken({ id: 'user-aaa', email: 'a@example.com' });
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token()}`);

  it('renames the user and persists (visible via GET /me)', async () => {
    const renamed = await auth(request(app).patch('/api/v1/auth/me')).send({ name: 'New Name' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('New Name');
    expect(renamed.body.data.email).toBe('a@example.com');
    expect(renamed.body.data.password_hash).toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      ['New Name', 'user-aaa']
    );
  });

  it('ignores protected fields sent alongside the name', async () => {
    const res = await auth(request(app).patch('/api/v1/auth/me')).send({
      name: 'Safe Name',
      email: 'evil@example.com',
      password_hash: 'x',
      status: 'disabled',
      id: 'user-evil',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Safe Name');
    expect(res.body.data.email).toBe('a@example.com');
    expect(res.body.data.status).toBe('active');
    // Exactly one column is ever written.
    const updates = (pool.query as jest.Mock).mock.calls.filter(([sql]: string[]) =>
      sql.startsWith('UPDATE users SET name')
    );
    expect(updates).toHaveLength(1);
  });

  it('rejects empty and overlong names', async () => {
    for (const bad of ['', '   ', 'x'.repeat(256)]) {
      const res = await auth(request(app).patch('/api/v1/auth/me')).send({ name: bad });
      expect(res.status).toBe(400);
    }
  });

  it('requires authentication', async () => {
    const anon = await request(app).patch('/api/v1/auth/me').send({ name: 'Nope' });
    expect(anon.status).toBe(401);
    const bad = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', 'Bearer garbage')
      .send({ name: 'Nope' });
    expect(bad.status).toBe(401);
  });
});
