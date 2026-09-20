/**
 * Phase 20 — security boundary: cross-user isolation.
 *
 * - Customer A cannot see or affect Customer B (no id-taking routes exist;
 *   smuggled ids in bodies are ignored).
 * - Internal admin JWTs are useless on customer routes (cookie-only).
 * - Legacy chat tokens are useless on customer routes.
 * - Customer cookies are useless on every admin API (401 across the board),
 *   including ADMIN-only writes (which additionally 403 operators).
 * - Expired sessions fail closed; redeem attempts are rate-limited.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { resetIdempotencyForTests } from '../services/messageIdempotency';
import { bearerFor, useInternalAuthSecret } from './helpers/internalAuth';
import { LlmProvider } from '../agent/llm';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

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

const CHAT_SECRET = 'customer-isolation-test-chat-secret';

const conv = (id: string) =>
  ({
    id,
    lead_id: null,
    user_id: 'admin-user-1',
    channel: 'web',
    status: 'active',
    started_at: new Date().toISOString(),
    ended_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }) as any;

describe('customer/admin security boundary', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let restoreAuth: (() => void) | null = null;
  const sessions = new Map<string, any>();
  const grants = new Map<string, string>();
  let seq = 0;
  let msgSeq = 0;

  const live = (row: any): boolean =>
    !row.revoked_at && new Date(row.expires_at).getTime() > Date.now();

  beforeAll(() => {
    for (const key of [
      'CHAT_JWT_SECRET',
      'CHAT_RATE_LIMIT_MAX',
      'CHAT_MESSAGE_RATE_LIMIT_MAX',
      'CHAT_MAX_MESSAGE_LENGTH',
      'LLM_PROVIDER',
      'CUSTOMER_REDEEM_MAX_ATTEMPTS',
      'CUSTOMER_REDEEM_WINDOW_MS',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.CHAT_JWT_SECRET = CHAT_SECRET;
    process.env.CHAT_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MESSAGE_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MAX_MESSAGE_LENGTH = '4000';
    process.env.LLM_PROVIDER = 'mock';
    restoreAuth = useInternalAuthSecret();
  });

  afterAll(() => {
    restoreAuth?.();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetChatRateLimitsForTests();
    resetIdempotencyForTests();
    sessions.clear();
    grants.clear();
    seq = 0;
    msgSeq = 0;
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM conversations WHERE id = $1 AND user_id = $2')) {
        const id = params[0];
        if ((id === 'conv-iso-a' || id === 'conv-iso-b') && params[1] === 'admin-user-1') {
          return { rows: [conv(id)] };
        }
        return { rows: [] };
      }
      if (sql.includes('FROM conversations WHERE id = $1')) {
        const id = params[0];
        if (id === 'conv-iso-a' || id === 'conv-iso-b') return { rows: [conv(id)] };
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO customer_access_tokens')) {
        return {
          rows: [
            {
              id: `cat-${++seq}`,
              conversation_id: params[0],
              token_hash: params[1],
              expires_at: params[2],
              revoked_at: null,
            },
          ],
        };
      }
      if (sql.includes('FROM customer_access_tokens')) {
        // Grants issued through the real share endpoint in these tests.
        const conversationId = grants.get(params[0]);
        return {
          rows: conversationId
            ? [
                {
                  id: 'cat-issued',
                  conversation_id: conversationId,
                  token_hash: params[0],
                  expires_at: new Date(Date.now() + 3600_000).toISOString(),
                  revoked_at: null,
                },
              ]
            : [],
        };
      }
      if (sql.includes('INSERT INTO customer_sessions')) {
        const row = {
          id: `csess-${++seq}`,
          conversation_id: params[0],
          session_hash: params[1],
          expires_at: params[2],
          revoked_at: null,
          last_seen_at: new Date().toISOString(),
        };
        sessions.set(row.session_hash, row);
        return { rows: [row] };
      }
      if (sql.includes('FROM customer_sessions')) {
        const row = sessions.get(params[0]);
        return { rows: row && live(row) ? [row] : [] };
      }
      if (sql.includes('UPDATE customer_sessions SET last_seen_at')) return { rows: [] };
      if (sql.includes('FROM conversation_messages')) {
        // Per-conversation histories: A and B never mix.
        return {
          rows:
            params[0] === 'conv-iso-a'
              ? [
                  {
                    id: 'msg-a1',
                    role: 'user',
                    content: 'A says hi',
                    created_at: new Date().toISOString(),
                  },
                ]
              : [],
        };
      }
      if (sql.includes('INSERT INTO conversation_messages')) {
        return {
          rows: [
            {
              id: `msg-${++msgSeq}`,
              conversation_id: params[0],
              role: params[1],
              content: params[2],
              metadata: params[3],
              tool_calls: params[4],
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (sql.includes('UPDATE conversation_states SET')) return { rows: [{}] };
      if (sql.includes('INSERT INTO conversation_states')) return { rows: [{}] };
      if (sql.includes('FROM conversation_states')) return { rows: [] };
      if (sql.includes('FROM leads WHERE')) return { rows: [] };
      return { rows: [] };
    });
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const scripted: LlmProvider = {
      getProviderName: () => 'scripted-isolation-test',
      generateResponse: async () => ({ content: 'Isolation reply.', finishReason: 'stop' }),
    } as any;
    jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(scripted);
  });

  const issueFor = async (conversationId: string): Promise<string> => {
    const share = await request(app)
      .post(`/api/v1/conversations/${conversationId}/customer-access`)
      .set('Authorization', bearerFor());
    expect(share.status).toBe(201);
    const raw = share.body.data.url.split('/chat/')[1] as string;
    const { hashCustomerToken } = require('../middleware/customerAuth') as typeof import('../middleware/customerAuth');
    grants.set(hashCustomerToken(raw), conversationId);
    return raw;
  };

  const redeemCookie = async (accessToken: string): Promise<string> => {
    const res = await request(app).post('/api/v1/customer/session').send({ accessToken });
    expect(res.status).toBe(201);
    const setCookies = res.headers['set-cookie'] as unknown;
    const list = Array.isArray(setCookies) ? (setCookies as string[]) : [];
    const session = list.find((c) => c.startsWith('mad_cs='));
    expect(session).toBeDefined();
    return (session as string).split(';')[0];
  };

  const seedSessionCookie = async (conversationId: string): Promise<string> => {
    // Bypass redeem: mint a live session row directly (same shape redeem
    // creates) to isolate session-scoping from token handling.
    const raw = `session-raw-for-${conversationId}`;
    const { hashCustomerToken } = require('../middleware/customerAuth') as typeof import('../middleware/customerAuth');
    const hash = hashCustomerToken(raw);
    sessions.set(hash, {
      id: `csess-seed-${++seq}`,
      conversation_id: conversationId,
      session_hash: hash,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      revoked_at: null,
      last_seen_at: new Date().toISOString(),
    });
    return `mad_cs=${raw}`;
  };

  it('keeps Customer A blind to Conversation B (no id-taking routes, smuggled ids ignored)', async () => {
    const cookieA = await seedSessionCookie('conv-iso-a');

    const mine = await request(app).get('/api/v1/customer/conversation').set('Cookie', cookieA);
    expect(mine.status).toBe(200);
    expect(mine.body.data.id).toBe('conv-iso-a');

    const history = await request(app).get('/api/v1/customer/messages').set('Cookie', cookieA);
    expect(history.status).toBe(200);
    expect(history.body.data.messages).toHaveLength(1);
    expect(history.body.data.messages[0].content).toBe('A says hi');

    // No route addresses another conversation; a forged id in the body is
    // ignored — the turn lands on A's conversation only.
    const forged = await request(app)
      .post('/api/v1/customer/messages')
      .set('Cookie', cookieA)
      .send({ content: 'Hello from A', conversationId: 'conv-iso-b', conversation_id: 'conv-iso-b' });
    expect(forged.status).toBe(201);
    expect(forged.body.data.userMessage.content).toBe('Hello from A');

    // Unknown customer paths 404 (Express default).
    const unknown = await request(app)
      .get('/api/v1/customer/conversations/conv-iso-b')
      .set('Cookie', cookieA);
    expect(unknown.status).toBe(404);

    // Every persisted message row belongs to A's conversation only.
    const persistedConversationIds = (pool.query as jest.Mock).mock.calls
      .filter(([sql]: string[]) => sql.includes('INSERT INTO conversation_messages'))
      .map(([, params]: any[]) => params[0]);
    expect(persistedConversationIds.length).toBeGreaterThan(0);
    expect(persistedConversationIds.every((id) => id === 'conv-iso-a')).toBe(true);
  });

  it('rejects internal admin JWTs and legacy chat tokens on customer routes', async () => {
    const adminDenied = await request(app)
      .get('/api/v1/customer/conversation')
      .set('Authorization', bearerFor());
    expect(adminDenied.status).toBe(401);

    const legacyDenied = await request(app)
      .get('/api/v1/customer/conversation')
      .set('Authorization', `Bearer ${signChatToken('tester', 3600, CHAT_SECRET)}`);
    expect(legacyDenied.status).toBe(401);

    const bareDenied = await request(app).post('/api/v1/customer/messages').send({ content: 'x' });
    expect(bareDenied.status).toBe(401);
  });

  it('rejects customer cookies across every admin API', async () => {
    const cookieA = await seedSessionCookie('conv-iso-a');
    const adminPaths: Array<[string, string]> = [
      ['get', '/api/v1/leads'],
      ['get', '/api/v1/leads/lead-1'],
      ['get', '/api/v1/qualifications'],
      ['get', '/api/v1/dashboard/qualification-mix'],
      ['get', '/api/v1/settings'],
      ['get', '/api/v1/crm/diagnostics'],
      ['get', '/api/v1/whatsapp/deliveries'],
      ['get', '/api/v1/agent/config'],
      ['get', '/api/v1/agent/health'],
      ['get', '/api/v1/knowledge/documents'],
      ['get', '/api/v1/followups'],
      ['get', '/api/v1/calendar/sync-status'],
      ['get', '/api/v1/n8n/workflows'],
      ['get', '/api/v1/conversations/conv-iso-b'],
    ];
    for (const [method, path] of adminPaths) {
      const res =
        method === 'get'
          ? await request(app).get(path).set('Cookie', cookieA)
          : await request(app).post(path).set('Cookie', cookieA);
      expect(res.status).toBe(401);
    }
    // ADMIN-only writes fail closed for cookie callers too.
    const patch = await request(app)
      .patch('/api/v1/settings')
      .set('Cookie', cookieA)
      .send({ workspace_name: 'x' });
    expect(patch.status).toBe(401);
  });

  it('fails closed on expired customer sessions', async () => {
    const cookieA = await seedSessionCookie('conv-iso-a');
    for (const row of sessions.values()) {
      row.expires_at = new Date(Date.now() - 1000).toISOString();
    }
    const res = await request(app).get('/api/v1/customer/conversation').set('Cookie', cookieA);
    expect(res.status).toBe(401);
  });

  it('rate-limits access-token redemption (brute-force protection)', async () => {
    const prevMax = process.env.CUSTOMER_REDEEM_MAX_ATTEMPTS;
    const prevWindow = process.env.CUSTOMER_REDEEM_WINDOW_MS;
    process.env.CUSTOMER_REDEEM_MAX_ATTEMPTS = '2';
    process.env.CUSTOMER_REDEEM_WINDOW_MS = '60000';
    resetChatRateLimitsForTests();
    try {
      const first = await request(app).post('/api/v1/customer/session').send({ accessToken: 'bad-1' });
      expect(first.status).toBe(401);
      const second = await request(app).post('/api/v1/customer/session').send({ accessToken: 'bad-2' });
      expect(second.status).toBe(401);
      const limited = await request(app).post('/api/v1/customer/session').send({ accessToken: 'bad-3' });
      expect(limited.status).toBe(429);
    } finally {
      if (prevMax === undefined) delete process.env.CUSTOMER_REDEEM_MAX_ATTEMPTS;
      else process.env.CUSTOMER_REDEEM_MAX_ATTEMPTS = prevMax;
      if (prevWindow === undefined) delete process.env.CUSTOMER_REDEEM_WINDOW_MS;
      else process.env.CUSTOMER_REDEEM_WINDOW_MS = prevWindow;
      resetChatRateLimitsForTests();
    }
  });

  it('issues and redeems end to end for a second conversation independently', async () => {
    const rawB = await issueFor('conv-iso-b');
    const cookieB = await redeemCookie(rawB);
    const mine = await request(app).get('/api/v1/customer/conversation').set('Cookie', cookieB);
    expect(mine.status).toBe(200);
    expect(mine.body.data.id).toBe('conv-iso-b');
    const history = await request(app).get('/api/v1/customer/messages').set('Cookie', cookieB);
    expect(history.status).toBe(200);
    expect(history.body.data.messages).toHaveLength(0);
  });
});
