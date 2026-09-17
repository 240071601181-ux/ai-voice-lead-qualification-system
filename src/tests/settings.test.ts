/**
 * Workspace settings API.
 *
 * Covers GET /api/v1/settings (seeded defaults) and PATCH /api/v1/settings
 * (round-trip persistence, server-side validation). The pool is mocked —
 * no live database required.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';

jest.mock('../database', () => {
  const mPool = {
    query: jest.fn()
  };
  return { pool: mPool, default: mPool };
});

const mockQuery = pool.query as jest.Mock;

const defaultRow = {
  id: 1,
  workspace_name: 'Acme Cargo',
  timezone: 'Asia/Kolkata',
  default_language: 'English',
  lead_score_threshold: 70,
  notify_hot_lead: true,
  notify_integration_failure: true,
  notify_followup_due: true,
  notify_daily_digest: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Workspace settings API', () => {
  it('returns the persisted settings row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [defaultRow] });
    const res = await request(app).get('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.workspace_name).toBe('Acme Cargo');
    expect(res.body.data.lead_score_threshold).toBe(70);
  });

  it('seeds defaults when the row is missing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [defaultRow] });
    const res = await request(app).get('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(res.body.data.workspace_name).toBe('Acme Cargo');
  });

  it('persists a workspace name change (PATCH round-trip)', async () => {
    const updated = { ...defaultRow, workspace_name: 'MadVoice Logistics' };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });
    const patch = await request(app)
      .patch('/api/v1/settings')
      .send({ workspace_name: 'MadVoice Logistics' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.workspace_name).toBe('MadVoice Logistics');

    mockQuery.mockResolvedValueOnce({ rows: [updated] });
    const reread = await request(app).get('/api/v1/settings');
    expect(reread.body.data.workspace_name).toBe('MadVoice Logistics');
  });

  it('persists notification toggles', async () => {
    const updated = { ...defaultRow, notify_daily_digest: true, notify_hot_lead: false };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });
    const patch = await request(app)
      .patch('/api/v1/settings')
      .send({ notify_daily_digest: true, notify_hot_lead: false });
    expect(patch.status).toBe(200);
    expect(patch.body.data.notify_daily_digest).toBe(true);
    expect(patch.body.data.notify_hot_lead).toBe(false);
  });

  it('validates every field server-side', async () => {
    const cases: Array<{ body: Record<string, unknown>; message: RegExp }> = [
      { body: {}, message: /No editable setting fields/ },
      { body: { workspace_name: '   ' }, message: /workspace_name/ },
      { body: { workspace_name: 'x'.repeat(101) }, message: /at most 100/ },
      { body: { timezone: 'Mars/Olympus' }, message: /timezone/ },
      { body: { default_language: 'Klingon' }, message: /default_language/ },
      { body: { lead_score_threshold: 101 }, message: /lead_score_threshold/ },
      { body: { lead_score_threshold: 'high' }, message: /lead_score_threshold/ },
      { body: { notify_hot_lead: 'yes' }, message: /must be a boolean/ },
      { body: { theme: 'dark' }, message: /Unknown setting/ }
    ];
    for (const c of cases) {
      const res = await request(app).patch('/api/v1/settings').send(c.body);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(c.message);
    }
  });

  it('serves settings from the alternate frontend origin with credentials', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [defaultRow] });
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Origin', 'http://localhost:3001');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
