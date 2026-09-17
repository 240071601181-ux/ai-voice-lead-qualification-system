import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import {
  requireConversationAuth,
  signChatToken,
  verifyChatToken,
} from '../middleware/conversationAuth';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const SECRET = 'phase10-chat-auth-test-secret';

describe('Phase 10: chat authentication', () => {
  const savedSecret = process.env.CHAT_JWT_SECRET;

  beforeAll(() => {
    process.env.CHAT_JWT_SECRET = SECRET;
  });

  afterAll(() => {
    if (savedSecret === undefined) delete process.env.CHAT_JWT_SECRET;
    else process.env.CHAT_JWT_SECRET = savedSecret;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signChatToken / verifyChatToken', () => {
    it('round-trips the authenticated subject', () => {
      const token = signChatToken('maya@example.com', 3600, SECRET);
      expect(verifyChatToken(token, SECRET)).toBe('maya@example.com');
    });

    it('rejects expired tokens', () => {
      const token = signChatToken('user-1', -10, SECRET);
      expect(() => verifyChatToken(token, SECRET)).toThrow('expired token');
    });

    it('rejects tokens signed with a different secret', () => {
      const token = signChatToken('user-1', 3600, 'another-secret');
      expect(() => verifyChatToken(token, SECRET)).toThrow('invalid signature');
    });

    it('rejects malformed tokens and tokens without a subject', () => {
      expect(() => verifyChatToken('not-a-token', SECRET)).toThrow();
      expect(() => verifyChatToken('a.b', SECRET)).toThrow();
      expect(() => signChatToken('', 3600, SECRET)).toThrow('subject is required');
    });

    it('refuses to sign or verify without a configured secret', () => {
      expect(() => signChatToken('user-1', 3600, '')).toThrow('CHAT_JWT_SECRET is not configured');
      expect(() => verifyChatToken('a.b.c', '')).toThrow('CHAT_JWT_SECRET is not configured');
    });

    it('never embeds the secret in the token', () => {
      const token = signChatToken('user-1', 3600, SECRET);
      expect(token).not.toContain(SECRET);
      expect(Buffer.from(token.split('.')[1], 'base64').toString('utf-8')).not.toContain(SECRET);
    });
  });

  describe('requireConversationAuth middleware', () => {
    const run = (headers: Record<string, string | undefined>, secret?: string) =>
      new Promise<{ status: number; body: any; nextCalled: boolean; subject?: string }>((resolve) => {
        if (secret === undefined) process.env.CHAT_JWT_SECRET = SECRET;
        else if (secret === null) delete (process.env as any).CHAT_JWT_SECRET;
        else process.env.CHAT_JWT_SECRET = secret;
        const req: any = { headers, chatSubject: undefined };
        const res: any = {
          status: (code: number) => ({
            json: (body: any) => resolve({ status: code, body, nextCalled: false }),
          }),
        };
        requireConversationAuth(req, res, () => {
          resolve({ status: 200, body: null, nextCalled: true, subject: req.chatSubject });
        });
      });

    it('passes a valid token and exposes its subject', async () => {
      const token = signChatToken('operator-7', 3600, SECRET);
      const out = await run({ authorization: `Bearer ${token}` });
      expect(out.nextCalled).toBe(true);
      expect(out.subject).toBe('operator-7');
    });

    it('rejects missing/malformed headers with 401 and no secret leakage', async () => {
      for (const headers of [{}, { authorization: 'Bearer ' }, { authorization: 'Token abc' }]) {
        const out = await run(headers as Record<string, string>);
        expect(out.status).toBe(401);
        expect(JSON.stringify(out.body)).not.toContain(SECRET);
      }
    });

    it('rejects expired and foreign tokens with 401 and clean messages', async () => {
      const expired = signChatToken('user-1', -5, SECRET);
      const foreign = signChatToken('user-1', 3600, 'other-secret');
      for (const token of [expired, foreign, 'garbage']) {
        const out = await run({ authorization: `Bearer ${token}` });
        expect(out.status).toBe(401);
        expect(out.body.error.message).toMatch(/Invalid or expired token/);
        expect(JSON.stringify(out.body)).not.toContain(SECRET);
      }
    });

    it('fail-closes when no secret is configured', async () => {
      const token = signChatToken('user-1', 3600, SECRET);
      const out = await run({ authorization: `Bearer ${token}` }, null as any);
      expect(out.status).toBe(401);
      process.env.CHAT_JWT_SECRET = SECRET;
    });
  });

  describe('protected conversation routes', () => {
    it('returns 401 without a token and never leaks the secret', async () => {
      const res = await request(app).get('/api/v1/conversations');
      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it('accepts a valid short-lived token', async () => {
      (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM conversations')) return { rows: [] };
        if (sql.includes('COUNT(*)')) return { rows: [{ total: '0' }] };
        return { rows: [] };
      });
      const token = signChatToken('dev-operator', 300, SECRET);
      const res = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });
});
