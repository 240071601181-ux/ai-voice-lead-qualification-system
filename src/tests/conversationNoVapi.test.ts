/**
 * Phase 14 — voice/Vapi retirement regression.
 *
 * Proves the text conversation API is fully independent of the retired
 * voice system:
 * 1. No Vapi configuration surface remains (getVapiConfig /
 *    isVapiCallConfigured are gone; VAPI_* vars are unread).
 * 2. Creating a text conversation works with VAPI_* absent from the
 *    environment (dummy fixtures only — no real data).
 * 3. The retired voice routes are gone (404) while text routes work.
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

const TEST_SECRET = 'novapi-test-secret-do-not-use-in-prod';

describe('text conversations without Vapi (Phase 14)', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('VAPI_')) savedEnv[key] = process.env[key];
    }
    for (const key of ['CHAT_JWT_SECRET', 'CHAT_RATE_LIMIT_MAX', 'LLM_PROVIDER']) {
      savedEnv[key] = process.env[key];
    }
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('VAPI_')) delete process.env[key];
    }
    process.env.CHAT_JWT_SECRET = TEST_SECRET;
    process.env.CHAT_RATE_LIMIT_MAX = '1000';
    process.env.LLM_PROVIDER = 'mock';
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
  });

  const auth = () => `Bearer ${signChatToken('tester', 3600, TEST_SECRET)}`;

  it('exposes no Vapi configuration surface', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require('../config');
    expect(config.getVapiConfig).toBeUndefined();
    expect(config.isVapiCallConfigured).toBeUndefined();
    expect(Object.keys(process.env).filter((k) => k.startsWith('VAPI_'))).toEqual([]);
  });

  it('creates a text conversation with VAPI_* absent', async () => {
    (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT INTO conversations')) {
        return {
          rows: [
            {
              id: 'conv-novapi',
              lead_id: null,
              channel: 'web',
              status: 'active',
              user_id: null,
              created_at: '2026-09-19T00:00:00.000Z',
              updated_at: '2026-09-19T00:00:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const res = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', auth())
      .send({ channel: 'web' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('conv-novapi');
  });

  it('keeps text routes live while voice routes 404', async () => {
    (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ total: '0' }] };
      return { rows: [] };
    });
    const list = await request(app).get('/api/v1/conversations').set('Authorization', auth());
    expect(list.status).toBe(200);

    for (const gone of [
      ['post', '/api/v1/calls/start'],
      ['post', '/api/v1/vapi/custom-llm/chat/completions'],
      ['post', '/api/v1/webhooks/vapi'],
    ] as const) {
      const res = await request(app)[gone[0]](gone[1]).set('Authorization', auth()).send({});
      expect(res.status).toBe(404);
    }
  });
});
