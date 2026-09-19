/**
 * Phase 13 — conversation list lead summaries (customer-name display).
 *
 * Proves GET /api/v1/conversations attaches a SAFE lead summary per row:
 * exactly { id, name, phone, email, status } (no duplicate customer table,
 * no extra lead fields), null when unlinked or missing. The frontend
 * renders lead.name (never a UUID) with truthful fallbacks.
 *
 * Dummy fixtures only — no real data.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const TEST_SECRET = 'list-lead-test-secret-do-not-use-in-prod';

const convLinked = {
  id: 'conv-111',
  lead_id: 'lead-111',
  channel: 'web',
  status: 'active',
  user_id: null,
  created_at: '2026-09-19T00:00:00.000Z',
  updated_at: '2026-09-19T00:00:00.000Z',
};
const convUnlinked = {
  id: 'conv-222',
  lead_id: null,
  channel: 'web',
  status: 'active',
  user_id: null,
  created_at: '2026-09-19T00:00:00.000Z',
  updated_at: '2026-09-19T00:00:00.000Z',
};
const leadRow = {
  id: 'lead-111',
  source: 'web',
  name: 'Rajesh Kumar',
  phone: '+911234567890',
  email: 'rajesh@example.com',
  status: 'NEW',
  created_at: '2026-09-19T00:00:00.000Z',
  updated_at: '2026-09-19T00:00:00.000Z',
};

describe('conversation list lead summaries', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ['CHAT_JWT_SECRET', 'CHAT_RATE_LIMIT_MAX']) {
      savedEnv[key] = process.env[key];
    }
    process.env.CHAT_JWT_SECRET = TEST_SECRET;
    process.env.CHAT_RATE_LIMIT_MAX = '1000';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetChatRateLimitsForTests();
    (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM leads')) return { rows: [leadRow] };
      if (sql.includes('COUNT(*)')) return { rows: [{ total: '2' }] };
      if (sql.includes('FROM conversations')) return { rows: [convLinked, convUnlinked] };
      return { rows: [] };
    });
  });

  const auth = () => `Bearer ${signChatToken('tester', 3600, TEST_SECRET)}`;

  it('attaches exactly the safe lead fields per row', async () => {
    const res = await request(app).get('/api/v1/conversations').set('Authorization', auth());
    expect(res.status).toBe(200);
    const rows = res.body.data.conversations;
    expect(rows).toHaveLength(2);
    expect(rows[0].lead).toEqual({
      id: 'lead-111',
      name: 'Rajesh Kumar',
      phone: '+911234567890',
      email: 'rajesh@example.com',
      status: 'NEW',
    });
    // No extra lead internals leak through the summary.
    expect(rows[0].lead).not.toHaveProperty('source');
    expect(rows[0].lead).not.toHaveProperty('created_at');
  });

  it('resolves lead to null when the conversation is unlinked', async () => {
    const res = await request(app).get('/api/v1/conversations').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.data.conversations[1].lead).toBeNull();
  });

  it('resolves lead to null when the lead row is gone', async () => {
    (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM leads')) return { rows: [] };
      if (sql.includes('COUNT(*)')) return { rows: [{ total: '1' }] };
      if (sql.includes('FROM conversations')) return { rows: [convLinked] };
      return { rows: [] };
    });
    const res = await request(app).get('/api/v1/conversations').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.data.conversations[0].lead).toBeNull();
  });
});
