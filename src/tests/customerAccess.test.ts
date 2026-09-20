/**
 * Phase 20 — customer access lifecycle (share → redeem → session use).
 *
 * - Internal owners issue single-conversation links (raw token returned once
 *   in the URL; only the hash persists — proven by recomputation).
 * - Non-owners get 404, anonymous/legacy callers get 401 on share endpoints.
 * - Redeem mints an HttpOnly-cookie session and a minimal summary; bad
 *   tokens fail closed with 401 and set no cookie.
 * - The session drives conversation reads, a full message turn (same
 *   agent/orchestrator as internal), state, qualification, and meeting
 *   availability — then logout revokes and revocation cuts access.
 */
import request from 'supertest';
import { createHmac } from 'crypto';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { resetIdempotencyForTests } from '../services/messageIdempotency';
import { bearerFor, INTERNAL_AUTH_SECRET, useInternalAuthSecret } from './helpers/internalAuth';
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

const CHAT_SECRET = 'customer-access-test-chat-secret';
const AUTH_SECRET = INTERNAL_AUTH_SECRET;

interface StoredToken {
  id: string;
  conversation_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

const convA = {
  id: 'conv-cust-a',
  lead_id: null,
  user_id: 'admin-user-1',
  channel: 'web',
  status: 'active',
  started_at: new Date().toISOString(),
  ended_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as any;

const memState = {
  id: 'st-cust-a',
  conversation_id: 'conv-cust-a',
  customer_name: 'Santhosh',
  pickup_location: 'Chennai',
  destination: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as any;

describe('customer access lifecycle', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let restoreAuth: (() => void) | null = null;
  const tokens = new Map<string, StoredToken>();
  const sessions = new Map<
    string,
    {
      id: string;
      conversation_id: string;
      session_hash: string;
      expires_at: string;
      revoked_at: string | null;
      last_seen_at: string;
    }
  >();
  let seq = 0;
  let msgSeq = 0;

  const live = (row: { revoked_at: string | null; expires_at: string }): boolean =>
    !row.revoked_at && new Date(row.expires_at).getTime() > Date.now();

  beforeAll(() => {
    for (const key of [
      'CHAT_JWT_SECRET',
      'CHAT_RATE_LIMIT_MAX',
      'CHAT_MESSAGE_RATE_LIMIT_MAX',
      'CHAT_MAX_MESSAGE_LENGTH',
      'LLM_PROVIDER',
      'CALENDAR_ENABLED',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.CHAT_JWT_SECRET = CHAT_SECRET;
    process.env.CHAT_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MESSAGE_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MAX_MESSAGE_LENGTH = '4000';
    process.env.LLM_PROVIDER = 'mock';
    // Deterministic meeting-availability outcome (truthful 503, no provider).
    process.env.CALENDAR_ENABLED = 'false';
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
    tokens.clear();
    sessions.clear();
    seq = 0;
    msgSeq = 0;
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM conversations WHERE id = $1 AND user_id = $2')) {
        return {
          rows: params[0] === convA.id && params[1] === 'admin-user-1' ? [convA] : [],
        };
      }
      if (sql.includes('FROM conversations WHERE id = $1 AND user_id IS NULL')) {
        return { rows: [] };
      }
      if (sql.includes('FROM conversations WHERE id = $1')) return { rows: [convA] };
      if (sql.includes('INSERT INTO customer_access_tokens')) {
        const row: StoredToken = {
          id: `cat-${++seq}`,
          conversation_id: params[0],
          token_hash: params[1],
          expires_at: params[2],
          revoked_at: null,
        };
        tokens.set(row.token_hash, row);
        return { rows: [row] };
      }
      if (sql.includes('FROM customer_access_tokens')) {
        const row = tokens.get(params[0]);
        return { rows: row && live(row) ? [row] : [] };
      }
      if (sql.includes('UPDATE customer_access_tokens SET revoked_at')) {
        let n = 0;
        for (const row of tokens.values()) {
          if (row.conversation_id === params[0] && !row.revoked_at) {
            row.revoked_at = new Date().toISOString();
            n += 1;
          }
        }
        return { rows: Array.from({ length: n }, () => ({})) };
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
      if (sql.includes('UPDATE customer_sessions SET revoked_at = NOW() WHERE id = $1')) {
        for (const row of sessions.values()) {
          if (row.id === params[0]) row.revoked_at = new Date().toISOString();
        }
        return { rows: [] };
      }
      if (sql.includes('UPDATE customer_sessions SET revoked_at = NOW()')) {
        let n = 0;
        for (const row of sessions.values()) {
          if (row.conversation_id === params[0] && !row.revoked_at) {
            row.revoked_at = new Date().toISOString();
            n += 1;
          }
        }
        return { rows: Array.from({ length: n }, () => ({})) };
      }
      if (sql.includes('FROM conversation_messages')) return { rows: [] };
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
      if (sql.includes('UPDATE conversation_states SET')) return { rows: [memState] };
      if (sql.includes('INSERT INTO conversation_states')) return { rows: [memState] };
      if (sql.includes('FROM conversation_states')) return { rows: [memState] };
      if (sql.includes('FROM leads WHERE')) return { rows: [] };
      return { rows: [] };
    });
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const scripted: LlmProvider = {
      getProviderName: () => 'scripted-customer-test',
      generateResponse: async () => ({ content: 'Noted from customer chat.', finishReason: 'stop' }),
    } as any;
    jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(scripted);
  });

  const adminAuth = () => bearerFor();
  const legacyAuth = () => `Bearer ${signChatToken('tester', 3600, CHAT_SECRET)}`;

  const issueLink = async () => {
    const res = await request(app)
      .post('/api/v1/conversations/conv-cust-a/customer-access')
      .set('Authorization', adminAuth());
    expect(res.status).toBe(201);
    return res.body.data as { url: string; expiresAt: string };
  };

  const redeem = async (accessToken: string) =>
    request(app).post('/api/v1/customer/session').send({ accessToken });

  const cookieFor = (res: request.Response): string | null =>
    allSetCookies(res).find((c: string) => c.startsWith('mad_cs='))?.split(';')[0] ?? null;

  const allSetCookies = (res: request.Response): string[] => {
    const raw = res.headers['set-cookie'] as unknown;
    return Array.isArray(raw) ? (raw as string[]) : [];
  };

  it('issues a single-use-visible link and stores only the hash', async () => {
    const { url, expiresAt } = await issueLink();
    expect(url).toMatch(/^http:\/\/localhost:3000\/chat\/[0-9a-f]{64}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    const raw = url.split('/chat/')[1];
    // The persisted grant is the HMAC hash, never the raw bearer value.
    expect(tokens.size).toBe(1);
    const stored = [...tokens.values()][0];
    expect(stored.token_hash).not.toBe(raw);
    expect(stored.token_hash).toBe(
      createHmac('sha256', AUTH_SECRET).update(raw).digest('hex')
    );
    expect(stored.conversation_id).toBe('conv-cust-a');
  });

  it('rejects share attempts without ownership or internal identity', async () => {
    const missing = await request(app)
      .post('/api/v1/conversations/conv-nope/customer-access')
      .set('Authorization', adminAuth());
    expect(missing.status).toBe(404);
    const anon = await request(app).post('/api/v1/conversations/conv-cust-a/customer-access');
    expect(anon.status).toBe(401);
    const legacy = await request(app)
      .post('/api/v1/conversations/conv-cust-a/customer-access')
      .set('Authorization', legacyAuth());
    expect(legacy.status).toBe(401);
  });

  it('redeems a valid link into an HttpOnly session with a minimal summary', async () => {
    const { url } = await issueLink();
    const res = await redeem(url.split('/chat/')[1]);
    expect(res.status).toBe(201);
    const cookie = cookieFor(res);
    expect(cookie).toMatch(/^mad_cs=/);
    const sessionCookie = allSetCookies(res).find((c) => c.startsWith('mad_cs='))!;
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
    expect(res.body.data.conversation).toEqual({
      id: 'conv-cust-a',
      status: 'active',
      channel: 'web',
    });
    // No lead rows, no messages, no internal data leak in the summary.
    expect(res.body.data.lead).toBeUndefined();
    expect(res.body.data.messages).toBeUndefined();
  });

  it('fails closed on invalid, expired, and revoked tokens', async () => {
    const bad = await redeem('0'.repeat(64));
    expect(bad.status).toBe(401);
    expect(cookieFor(bad)).toBeNull();

    const { url } = await issueLink();
    const raw = url.split('/chat/')[1];
    // Expire the grant server-side.
    [...tokens.values()].forEach((t) => {
      t.expires_at = new Date(Date.now() - 1000).toISOString();
    });
    const expired = await redeem(raw);
    expect(expired.status).toBe(401);

    const { url: url2 } = await issueLink();
    await request(app)
      .post('/api/v1/conversations/conv-cust-a/customer-access/revoke')
      .set('Authorization', adminAuth());
    const revoked = await redeem(url2.split('/chat/')[1]);
    expect(revoked.status).toBe(401);
  });

  it('serves the full customer surface from the session alone', async () => {
    const { url } = await issueLink();
    const session = await redeem(url.split('/chat/')[1]);
    const cookie = cookieFor(session)!;
    const withCookie = (req: request.Test) => req.set('Cookie', cookie);

    const convo = await withCookie(request(app).get('/api/v1/customer/conversation'));
    expect(convo.status).toBe(200);
    expect(convo.body.data).toEqual({ id: 'conv-cust-a', status: 'active', channel: 'web' });

    const sent = await withCookie(
      request(app).post('/api/v1/customer/messages').send({ content: 'Hi, I need a truck.' })
    ).set('Idempotency-Key', 'cust-key-1');
    expect(sent.status).toBe(201);
    expect(sent.body.data.userMessage.content).toBe('Hi, I need a truck.');
    expect(sent.body.data.assistantMessage.content).toBe('Noted from customer chat.');

    const history = await withCookie(request(app).get('/api/v1/customer/messages'));
    expect(history.status).toBe(200);

    const state = await withCookie(request(app).get('/api/v1/customer/state'));
    expect(state.status).toBe(200);
    expect(state.body.data.pickup_location).toBe('Chennai');

    const qual = await withCookie(request(app).get('/api/v1/customer/qualification'));
    expect(qual.status).toBe(404);

    // Meeting availability routes through the shared handler (disabled here).
    const avail = await withCookie(
      request(app)
        .get('/api/v1/customer/meeting/availability')
        .query({ start: '2026-10-01T10:00:00Z', end: '2026-10-01T10:30:00Z' })
    );
    expect(avail.status).toBe(503);
    expect(avail.body.error.message).toMatch(/not configured/i);
  });

  it('logs out: cookie cleared and session dead afterwards', async () => {
    const { url } = await issueLink();
    const session = await redeem(url.split('/chat/')[1]);
    const cookie = cookieFor(session)!;
    const out = await request(app).post('/api/v1/customer/logout').set('Cookie', cookie);
    expect(out.status).toBe(200);
    expect(out.body.data).toEqual({ loggedOut: true });
    const cleared = allSetCookies(out).find((c) => c.startsWith('mad_cs='))!;
    expect(cleared).toContain('Max-Age=0');

    const after = await request(app).get('/api/v1/customer/conversation').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('revocation cuts live sessions but keeps history intact', async () => {
    const { url } = await issueLink();
    const session = await redeem(url.split('/chat/')[1]);
    const cookie = cookieFor(session)!;
    const revoke = await request(app)
      .post('/api/v1/conversations/conv-cust-a/customer-access/revoke')
      .set('Authorization', adminAuth());
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revokedTokens).toBeGreaterThanOrEqual(1);
    expect(revoke.body.data.revokedSessions).toBeGreaterThanOrEqual(1);

    const after = await request(app).get('/api/v1/customer/conversation').set('Cookie', cookie);
    expect(after.status).toBe(401);
    // History itself is untouched: admin reads still work.
    const adminRead = await request(app)
      .get('/api/v1/conversations/conv-cust-a/messages')
      .set('Authorization', adminAuth());
    expect(adminRead.status).toBe(200);
  });
});
