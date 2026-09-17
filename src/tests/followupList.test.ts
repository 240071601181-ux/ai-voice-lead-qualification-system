/**
 * GET /api/v1/followups list endpoint tests (pool mocked).
 *
 * Covers: default paginated list with total, explicit pagination
 * (LIMIT/OFFSET), status/lead/action filters, invalid query params (400),
 * and empty results.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

describe('GET /api/v1/followups', () => {
  const row: any = {
    id: 'f-1',
    followup_key: 'fu:crm_followup:lead-1',
    lead_id: 'lead-1',
    call_id: null,
    qualification_id: null,
    action: 'crm_followup',
    payload: {},
    scheduled_at: '2026-09-12T10:00:00.000Z',
    status: 'pending',
    attempts: 1,
    last_error: null,
    created_at: '2026-09-12T09:00:00.000Z',
    updated_at: '2026-09-12T09:00:00.000Z',
  };

  const mockListReads = (rows: any[], total: string | number) => {
    (pool.query as jest.Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (/COUNT\(\*\)/.test(s)) return Promise.resolve({ rows: [{ total: String(total) }] });
      if (/FROM follow_ups/.test(s)) return Promise.resolve({ rows });
      return Promise.resolve({ rows: [] });
    });
  };

  const selectCall = () =>
    (pool.query as jest.Mock).mock.calls.find(
      (call: any[]) => /FROM follow_ups/.test(String(call[0])) && !/COUNT/.test(String(call[0]))
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns paginated follow-ups with total by default (page 1, limit 20)', async () => {
    mockListReads([row], 1);
    const res = await request(app).get('/api/v1/followups');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(res.body.data.followups).toHaveLength(1);
    expect(res.body.data.followups[0]).toMatchObject({ id: 'f-1', status: 'pending' });

    const call = selectCall();
    expect(call[0]).toContain('ORDER BY created_at DESC');
    expect(call[1]).toEqual([20, 0]);
  });

  it('honors explicit page/limit via LIMIT/OFFSET', async () => {
    mockListReads([row], 42);
    const res = await request(app).get('/api/v1/followups').query({ page: '2', limit: '5' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 42, page: 2, limit: 5 });
    expect(selectCall()[1]).toEqual([5, 5]);
  });

  it('applies status/lead/action filters to both queries', async () => {
    mockListReads([row], 1);
    const res = await request(app)
      .get('/api/v1/followups')
      .query({ status: 'pending', leadId: 'lead-1', action: 'crm_followup' });

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    for (const call of (pool.query as jest.Mock).mock.calls) {
      const sql = String(call[0]);
      expect(sql).toContain('status = $');
      expect(sql).toContain('lead_id = $');
      expect(sql).toContain('action = $');
    }
    expect(selectCall()[1].slice(0, 3)).toEqual(['pending', 'lead-1', 'crm_followup']);
  });

  it('rejects invalid params with 400', async () => {
    for (const query of [
      { page: '0' },
      { limit: '101' },
      { status: 'nope' },
      { action: 'nope' },
    ]) {
      const res = await request(app).get('/api/v1/followups').query(query);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns an empty list with total 0 when nothing matches', async () => {
    mockListReads([], 0);
    const res = await request(app).get('/api/v1/followups').query({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ total: 0, page: 1, limit: 20, followups: [] });
  });
});
