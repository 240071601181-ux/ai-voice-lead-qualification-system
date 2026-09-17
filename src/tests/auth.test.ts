import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { resetLoginRateLimitsForTests } from '../middleware/loginRateLimit';
import { signAccessToken } from '../services/authService';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const AUTH_SECRET = 'phase11-auth-test-secret';

const userA = {
  id: 'user-aaa',
  email: 'a@example.com',
  password_hash: 'hashed',
  name: 'User A',
  status: 'active',
  last_login_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const userB = { ...userA, id: 'user-bbb', email: 'b@example.com', name: 'User B' };

const convOwnedA = {
  id: 'conv-a',
  lead_id: null,
  channel: 'web',
  status: 'active',
  user_id: 'user-aaa',
  started_at: new Date().toISOString(),
  ended_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const convOwnedB = { ...convOwnedA, id: 'conv-b', user_id: 'user-bbb' };

describe('Phase 11: authentication API', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ['AUTH_JWT_SECRET', 'AUTH_ACCESS_TTL_SEC', 'AUTH_LOGIN_MAX_ATTEMPTS', 'AUTH_LOGIN_WINDOW_MS']) {
      savedEnv[key] = process.env[key];
    }
    process.env.AUTH_JWT_SECRET = AUTH_SECRET;
    process.env.AUTH_LOGIN_MAX_ATTEMPTS = '1000';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetLoginRateLimitsForTests();
  });

  const mockUsers = (byEmail: Record<string, any> = {}, byId: Record<string, any> = {}) => {
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM users WHERE LOWER(email)')) {
        const row = byEmail[String(params[0]).toLowerCase()];
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('FROM users WHERE id')) {
        const row = byId[params[0]];
        return { rows: row ? [row] : [] };
      }
      if (sql.startsWith('INSERT INTO users')) {
        const row = { ...userA, id: 'user-new', email: params[0], password_hash: params[1], name: params[2] };
        return { rows: [row] };
      }
      if (sql.startsWith('INSERT INTO user_sessions')) {
        return {
          rows: [{ id: 'sess-1', user_id: params[0], refresh_hash: params[1], expires_at: params[2] }],
        };
      }
      if (sql.startsWith('UPDATE users SET last_login_at')) return { rows: [] };
      if (sql.startsWith('UPDATE user_sessions SET revoked_at')) return { rows: [] };
      if (sql.includes('FROM user_sessions WHERE refresh_hash')) return { rows: [] };
      return { rows: [] };
    });
  };

  it('registers a user with a bcrypt hash and returns no secret material', async () => {
    const realHash = await bcrypt.hash('password-123', 4);
    void realHash;
    mockUsers();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'new@example.com', password: 'password-123', name: 'New User' });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email: 'new@example.com', name: 'New User' });
    expect(res.body.data.user.password_hash).toBeUndefined();
    expect(res.body.data.accessToken).toBeDefined();
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] || []);
    expect(cookies.join(';')).toContain('mad_rt=');
    expect(cookies.join(';')).toContain('HttpOnly');
    const insertCall = (pool.query as jest.Mock).mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO users'));
    expect(insertCall[1][1]).not.toBe('password-123');
    expect(insertCall[1][1]).toMatch(/^\$2[aby]\$/);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(AUTH_SECRET);
    expect(body).not.toContain('password-123');
  });

  it('rejects duplicate emails, bad emails, and short passwords', async () => {
    mockUsers({ 'taken@example.com': userA });
    const dup = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'taken@example.com', password: 'password-123' });
    expect(dup.status).toBe(409);
    const badEmail = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'password-123' });
    expect(badEmail.status).toBe(400);
    const short = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'x@example.com', password: 'short' });
    expect(short.status).toBe(400);
  });

  it('logs in with valid credentials and rejects wrong passwords without enumeration', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 4);
    mockUsers({ 'a@example.com': { ...userA, password_hash: passwordHash } });
    const ok = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@example.com', password: 'correct-horse' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user).toMatchObject({ id: 'user-aaa', email: 'a@example.com' });
    expect(ok.body.data.user.password_hash).toBeUndefined();

    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@example.com', password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('rate-limits credential stuffing with truthful 429', async () => {
    process.env.AUTH_LOGIN_MAX_ATTEMPTS = '2';
    resetLoginRateLimitsForTests();
    mockUsers();
    await request(app).post('/api/v1/auth/login').send({ email: 'a@e.com', password: 'x' });
    await request(app).post('/api/v1/auth/login').send({ email: 'a@e.com', password: 'x' });
    const limited = await request(app).post('/api/v1/auth/login').send({ email: 'a@e.com', password: 'x' });
    expect(limited.status).toBe(429);
    process.env.AUTH_LOGIN_MAX_ATTEMPTS = '1000';
  });

  it('serves /me for a valid session and 401 without one', async () => {
    mockUsers({}, { 'user-aaa': userA });
    const token = signAccessToken({ id: 'user-aaa', email: 'a@example.com' });
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ id: 'user-aaa', email: 'a@example.com' });
    expect(me.body.data.password_hash).toBeUndefined();

    const anon = await request(app).get('/api/v1/auth/me');
    expect(anon.status).toBe(401);
    const bad = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer garbage');
    expect(bad.status).toBe(401);
  });

  it('refreshes via cookie rotation and logs out with revocation', async () => {
    const session = { id: 'sess-1', user_id: 'user-aaa', refresh_hash: 'h', expires_at: new Date(Date.now() + 3600_000).toISOString(), revoked_at: null };
    (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_sessions WHERE refresh_hash')) return { rows: [session] };
      if (sql.includes('FROM users WHERE id')) return { rows: [userA] };
      if (sql.startsWith('INSERT INTO user_sessions')) {
        return { rows: [{ id: 'sess-2', user_id: 'user-aaa', refresh_hash: 'h2', expires_at: new Date().toISOString() }] };
      }
      if (sql.startsWith('UPDATE user_sessions SET revoked_at')) return { rows: [] };
      if (sql.startsWith('UPDATE users SET last_login_at')) return { rows: [] };
      return { rows: [] };
    });
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'mad_rt=presented-refresh-token');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeDefined();
    // Old session revoked (rotation).
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1',
      ['sess-1']
    );

    const noCookie = await request(app).post('/api/v1/auth/refresh');
    expect(noCookie.status).toBe(401);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', 'mad_rt=presented-refresh-token');
    expect(logout.status).toBe(200);
    expect(logout.body.data).toEqual({ loggedOut: true });
  });
});

describe('Phase 11: conversation ownership', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ['AUTH_JWT_SECRET', 'CHAT_JWT_SECRET', 'CHAT_RATE_LIMIT_MAX', 'CHAT_MESSAGE_RATE_LIMIT_MAX']) {
      savedEnv[key] = process.env[key];
    }
    process.env.AUTH_JWT_SECRET = AUTH_SECRET;
    process.env.CHAT_JWT_SECRET = 'legacy-secret-for-tests';
    process.env.CHAT_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MESSAGE_RATE_LIMIT_MAX = '1000';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const tokenA = () => signAccessToken({ id: 'user-aaa', email: 'a@example.com' });
  const tokenB = () => signAccessToken({ id: 'user-bbb', email: 'b@example.com' });

  const installMock = (convos: Record<string, any>) => {
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM users WHERE id')) {
        const id = params[0];
        const row = id === 'user-aaa' ? userA : id === 'user-bbb' ? userB : null;
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('SELECT * FROM conversations WHERE id = $1 AND user_id = $2')) {
        const row = convos[params[0]];
        return { rows: row && row.user_id === params[1] ? [row] : [] };
      }
      if (sql.includes('SELECT * FROM conversations WHERE id = $1 AND user_id IS NULL')) {
        const row = convos[params[0]];
        return { rows: row && (row.user_id ?? null) === null ? [row] : [] };
      }
      if (sql.includes('SELECT * FROM conversations')) {
        return { rows: Object.values(convos) };
      }
      if (sql.includes('SELECT COUNT(*) AS total FROM conversations')) {
        return { rows: [{ total: String(Object.keys(convos).length) }] };
      }
      if (sql.includes('FROM conversation_messages')) return { rows: [] };
      if (sql.includes('SELECT COUNT(*) AS total FROM conversation_messages')) {
        return { rows: [{ total: '0' }] };
      }
      if (sql.includes('FROM leads WHERE id')) return { rows: [] };
      return { rows: [] };
    });
  };

  const authA = (req: any) => req.set('Authorization', `Bearer ${tokenA()}`);

  it('denies cross-user access with 404 on detail, messages, qualification, state, and calendar', async () => {
    installMock({ 'conv-a': convOwnedA, 'conv-b': convOwnedB });
    const paths = [
      ['get', '/api/v1/conversations/conv-b'],
      ['get', '/api/v1/conversations/conv-b/messages'],
      ['get', '/api/v1/conversations/conv-b/qualification'],
      ['get', '/api/v1/conversations/conv-b/state'],
      ['get', '/api/v1/conversations/conv-b/calendar/availability?start=2026-09-20T10:00:00Z&end=2026-09-20T10:30:00Z'],
      ['post', '/api/v1/conversations/conv-b/messages'],
      ['post', '/api/v1/conversations/conv-b/complete'],
      ['post', '/api/v1/conversations/conv-b/qualification'],
      ['post', '/api/v1/conversations/conv-b/calendar/book'],
    ] as Array<['get' | 'post', string]>;
    for (const [method, path] of paths) {
      const res = method === 'get'
        ? await authA(request(app).get(path))
        : await authA(request(app).post(path).send({ content: 'hi', start: '2026-09-20T10:00:00Z', end: '2026-09-20T10:30:00Z' }));
      expect(`${method} ${path} → ${res.status}`).toBe(`${method} ${path} → 404`);
    }
    // Owner access works.
    const own = await authA(request(app).get('/api/v1/conversations/conv-a'));
    expect(own.status).toBe(200);
    expect(own.body.data.conversation.id).toBe('conv-a');
  });

  it('scopes lists to the caller and isolates legacy rows from users', async () => {
    installMock({ 'conv-a': convOwnedA });
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM users WHERE id')) return { rows: [userB] };
      if (sql.includes('SELECT COUNT(*) AS total FROM conversations')) return { rows: [{ total: '0' }] };
      if (sql.includes('SELECT * FROM conversations')) {
        expect(sql).toContain('user_id = $');
        expect(params).toContain('user-bbb');
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = await request(app).get('/api/v1/conversations').set('Authorization', `Bearer ${tokenB()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.conversations).toEqual([]);
  });

  it('rejects unauthenticated conversation access with 401', async () => {
    installMock({ 'conv-a': convOwnedA });
    const res = await request(app).get('/api/v1/conversations/conv-a');
    expect(res.status).toBe(401);
    const bad = await request(app)
      .get('/api/v1/conversations/conv-a')
      .set('Authorization', 'Bearer not-a-token');
    expect(bad.status).toBe(401);
  });

  it('keeps legacy unowned rows reachable by legacy tokens but hidden from users', async () => {
    const legacy = { ...convOwnedA, id: 'conv-legacy', user_id: null };
    const { signChatToken } = await import('../middleware/conversationAuth');
    installMock({ 'conv-legacy': legacy });
    const legacyToken = signChatToken('tester', 3600, 'legacy-secret-for-tests');
    const viaLegacy = await request(app)
      .get('/api/v1/conversations/conv-legacy')
      .set('Authorization', `Bearer ${legacyToken}`);
    expect(viaLegacy.status).toBe(200);

    // Legacy tokens cannot see owned rows.
    installMock({ 'conv-a': convOwnedA });
    const ownedViaLegacy = await request(app)
      .get('/api/v1/conversations/conv-a')
      .set('Authorization', `Bearer ${legacyToken}`);
    expect(ownedViaLegacy.status).toBe(404);

    // Users cannot see legacy rows.
    installMock({ 'conv-legacy': legacy });
    const legacyViaUser = await request(app)
      .get('/api/v1/conversations/conv-legacy')
      .set('Authorization', `Bearer ${tokenA()}`);
    expect(legacyViaUser.status).toBe(404);
  });
});
