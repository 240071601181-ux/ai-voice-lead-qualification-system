import request from 'supertest';
import app from '../app';
import { pool } from '../database';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const qual = (overrides: Record<string, unknown> = {}) => ({
  id: 'q-1',
  call_id: 'call-1',
  conversation_id: null,
  lead_id: 'lead-1',
  score: 80,
  tier: 'HOT',
  details: { criteria: {}, totalScore: 80, qualifiedAt: new Date().toISOString() },
  qualified_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe('Phase 10: qualification read endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists qualifications newest-first with pagination metadata', async () => {
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('SELECT * FROM qualifications ORDER BY')) {
        expect(params).toEqual([20, 0]);
        return { rows: [qual(), qual({ id: 'q-2', tier: 'WARM', score: 50 })] };
      }
      if (sql.includes('SELECT COUNT(*) AS total FROM qualifications')) {
        return { rows: [{ total: '2' }] };
      }
      return { rows: [] };
    });
    const res = await request(app).get('/api/v1/qualifications?page=1&limit=20');
    expect(res.status).toBe(200);
    expect(res.body.data.qualifications).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.page).toBe(1);
  });

  it('rejects invalid pagination without touching the database', async () => {
    const bad = await request(app).get('/api/v1/qualifications?page=0&limit=500');
    expect(bad.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns a single qualification by id, including conversation-anchored rows', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [qual({ id: 'q-conv-9', call_id: null, conversation_id: 'conv-9' })],
    });
    const res = await request(app).get('/api/v1/qualifications/q-conv-9');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'q-conv-9', call_id: null, conversation_id: 'conv-9' });
    expect(pool.query).toHaveBeenCalledWith('SELECT * FROM qualifications WHERE id = $1', ['q-conv-9']);
  });

  it('returns 404 for unknown qualification ids', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/v1/qualifications/q-missing');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
