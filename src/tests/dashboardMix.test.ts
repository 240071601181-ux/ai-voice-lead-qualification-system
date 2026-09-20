/**
 * Phase 17 — dashboard qualification mix (GET /api/v1/dashboard/qualification-mix).
 *
 * Proves the donut feeds on real SQL tier counts (HOT/WARM/COLD only),
 * ignores unknown tiers, and returns zeros on an empty table. Scoring
 * untouched; dummy fixtures only.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { bearerFor, useInternalAuthSecret } from './helpers/internalAuth';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

// Phase 20 — /api/v1/dashboard is internal: ADMIN identity for every call.
jest.mock('../repositories/userRepository', () => {
  const actual = jest.requireActual('../repositories/userRepository');
  return {
    ...actual,
    findUserById: jest.fn(async () => ({
      id: 'admin-user-1',
      email: 'admin@example.com',
      password_hash: 'hashed-test-only',
      name: 'Test Admin',
      role: 'ADMIN',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
  };
});

describe('dashboard qualification mix', () => {
  let restoreAuth: (() => void) | null = null;
  beforeAll(() => {
    restoreAuth = useInternalAuthSecret();
  });
  afterAll(() => {
    restoreAuth?.();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const authedGet = (url: string) => request(app).get(url).set('Authorization', bearerFor());

  it('returns real tier counts and ignores unknown tiers', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        { tier: 'HOT', n: 2 },
        { tier: 'WARM', n: 5 },
        { tier: 'COLD', n: 3 },
        { tier: 'MYSTERY', n: 99 },
      ],
    });
    const res = await authedGet('/api/v1/dashboard/qualification-mix');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ total: 10, hot: 2, warm: 5, cold: 3 });
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT tier, COUNT(*)::int AS n FROM qualifications GROUP BY tier'
    );
  });

  it('returns zeros on an empty qualifications table', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    const res = await authedGet('/api/v1/dashboard/qualification-mix');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ total: 0, hot: 0, warm: 0, cold: 0 });
  });
});
