/**
 * Phase 15 — aggregate agent-health metrics (real PostgreSQL aggregation).
 *
 * Proves GET /api/v1/agent/health-metrics returns database-backed values
 * (status counts, qualification rate, mean first-response seconds) and
 * NEVER a fabricated quality score (quality is always null with a reason).
 * Empty databases yield zeros/nulls, not failures. Dummy fixtures only.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

describe('agent health metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM conversations GROUP BY status')) {
        return { rows: [{ status: 'active', n: 3 }, { status: 'completed', n: 2 }] };
      }
      if (sql.includes('COUNT(DISTINCT conversation_id)')) {
        return { rows: [{ qualified: 2 }] };
      }
      if (sql.includes('AVG(EXTRACT(EPOCH')) {
        return { rows: [{ avg_sec: '42.5', n: 4 }] };
      }
      return { rows: [] };
    });
  });

  it('returns real aggregates with no fabricated quality', async () => {
    const res = await request(app).get('/api/v1/agent/health-metrics');
    expect(res.status).toBe(200);
    expect(res.body.data.textConversations).toEqual({
      total: 5,
      active: 3,
      completed: 2,
      abandoned: 0,
    });
    expect(res.body.data.qualification).toEqual({
      qualifiedConversations: 2,
      totalConversations: 5,
      ratePercent: 40,
    });
    expect(res.body.data.responsiveness).toEqual({
      avgFirstResponseSec: 42.5,
      conversationsMeasured: 4,
    });
    expect(res.body.data.quality).toBeNull();
    expect(typeof res.body.data.qualityReason).toBe('string');
  });

  it('yields zeros/nulls (not failures) on an empty database', async () => {
    (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('AVG(EXTRACT(EPOCH')) return { rows: [{ avg_sec: null, n: 0 }] };
      if (sql.includes('COUNT(DISTINCT conversation_id)')) return { rows: [{ qualified: 0 }] };
      return { rows: [] };
    });
    const res = await request(app).get('/api/v1/agent/health-metrics');
    expect(res.status).toBe(200);
    expect(res.body.data.textConversations.total).toBe(0);
    expect(res.body.data.qualification.ratePercent).toBeNull();
    expect(res.body.data.responsiveness.avgFirstResponseSec).toBeNull();
    expect(res.body.data.responsiveness.conversationsMeasured).toBe(0);
    expect(res.body.data.quality).toBeNull();
  });
});
