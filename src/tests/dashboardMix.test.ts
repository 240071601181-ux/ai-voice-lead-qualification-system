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

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

describe('dashboard qualification mix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns real tier counts and ignores unknown tiers', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        { tier: 'HOT', n: 2 },
        { tier: 'WARM', n: 5 },
        { tier: 'COLD', n: 3 },
        { tier: 'MYSTERY', n: 99 },
      ],
    });
    const res = await request(app).get('/api/v1/dashboard/qualification-mix');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ total: 10, hot: 2, warm: 5, cold: 3 });
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT tier, COUNT(*)::int AS n FROM qualifications GROUP BY tier'
    );
  });

  it('returns zeros on an empty qualifications table', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/v1/dashboard/qualification-mix');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ total: 0, hot: 0, warm: 0, cold: 0 });
  });
});
