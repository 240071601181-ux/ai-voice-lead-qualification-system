/**
 * Phase 20 — internal roles (ADMIN | OPERATOR).
 *
 * - Public registration mints OPERATOR, never ADMIN — unless the deployer
 *   explicitly named BOOTSTRAP_ADMIN_EMAIL.
 * - requireRole: 401 without a valid internal user, 403 for insufficient
 *   role, pass for sufficient role; unknown stored roles normalize to
 *   OPERATOR (never a silent ADMIN).
 * - ADMIN-only writes (settings PATCH) reject OPERATORs; reads stay open
 *   to every internal role; legacy chat tokens fail closed on admin APIs.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { normalizeRole } from '../models/User';
import { bearerFor, operatorUser, useInternalAuthSecret } from './helpers/internalAuth';

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

const userRepo = () => require('../repositories/userRepository') as any;

const adminRow = {
  id: 'admin-user-1',
  email: 'admin@example.com',
  password_hash: 'hashed-test-only',
  name: 'Test Admin',
  role: 'ADMIN',
  status: 'active',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('normalizeRole', () => {
  it('resolves ADMIN only for the exact value', () => {
    expect(normalizeRole('ADMIN')).toBe('ADMIN');
    expect(normalizeRole('OPERATOR')).toBe('OPERATOR');
    expect(normalizeRole(undefined)).toBe('OPERATOR');
    expect(normalizeRole(null)).toBe('OPERATOR');
    expect(normalizeRole('admin')).toBe('OPERATOR');
    expect(normalizeRole('SUPERADMIN')).toBe('OPERATOR');
    expect(normalizeRole('')).toBe('OPERATOR');
  });
});

describe('registration role assignment', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let restoreAuth: (() => void) | null = null;

  beforeAll(() => {
    for (const key of ['AUTH_JWT_SECRET', 'BOOTSTRAP_ADMIN_EMAIL']) {
      savedEnv[key] = process.env[key];
    }
    restoreAuth = useInternalAuthSecret();
  });

  afterAll(() => {
    restoreAuth?.();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (key === 'AUTH_JWT_SECRET') continue;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  });

  const mockRegisterReads = () => {
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM users WHERE')) return { rows: [] };
      if (sql.includes('INSERT INTO users')) {
        return {
          rows: [
            {
              id: 'new-user-1',
              email: params[0],
              role: params[3],
              status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO user_sessions')) {
        return {
          rows: [
            {
              id: 'sess-1',
              user_id: 'new-user-1',
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
            },
          ],
        };
      }
      if (sql.includes('UPDATE users SET last_login_at')) return { rows: [] };
      return { rows: [] };
    });
  };

  it('registers OPERATOR by default (never a silent ADMIN)', async () => {
    mockRegisterReads();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'new@example.com', password: 'password-123456' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('OPERATOR');
    const insert = (pool.query as jest.Mock).mock.calls.find(([s]: string[]) =>
      String(s).includes('INSERT INTO users')
    );
    expect(String(insert[0])).toContain('role');
    expect(insert[1][3]).toBe('OPERATOR');
  });

  it('assigns ADMIN only via the explicit BOOTSTRAP_ADMIN_EMAIL mechanism', async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'boss@example.com';
    mockRegisterReads();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'boss@example.com', password: 'password-123456' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('ADMIN');
  });
});

describe('requireRole enforcement on admin APIs', () => {
  let restoreAuth: (() => void) | null = null;

  beforeAll(() => {
    restoreAuth = useInternalAuthSecret();
  });
  afterAll(() => {
    restoreAuth?.();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    userRepo().findUserById.mockResolvedValue({ ...adminRow });
    (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workspace_settings')) {
        return {
          rows: [
            {
              id: 1,
              workspace_name: 'Acme Cargo',
              timezone: 'Asia/Kolkata',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  it('lets ADMIN write global settings', async () => {
    const res = await request(app)
      .patch('/api/v1/settings')
      .set('Authorization', bearerFor())
      .send({ workspace_name: 'MadLead Logistics' });
    expect(res.status).toBe(200);
  });

  it('rejects OPERATOR writes to ADMIN-only settings with 403', async () => {
    userRepo().findUserById.mockResolvedValue({ ...adminRow, id: 'operator-user-1', role: 'OPERATOR' });
    const res = await request(app)
      .patch('/api/v1/settings')
      .set('Authorization', bearerFor(operatorUser))
      .send({ workspace_name: 'MadLead Logistics' });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('lets OPERATOR read admin APIs', async () => {
    userRepo().findUserById.mockResolvedValue({ ...adminRow, id: 'operator-user-1', role: 'OPERATOR' });
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Authorization', bearerFor(operatorUser));
    expect(res.status).toBe(200);
  });

  it('rejects unauthenticated admin access with 401', async () => {
    const res = await request(app).get('/api/v1/settings');
    expect(res.status).toBe(401);
  });

  it('rejects legacy chat tokens on admin APIs with 401', async () => {
    const { signChatToken } = require('../middleware/conversationAuth') as typeof import('../middleware/conversationAuth');
    process.env.CHAT_JWT_SECRET = 'role-test-chat-secret';
    try {
      const res = await request(app)
        .get('/api/v1/settings')
        .set('Authorization', `Bearer ${signChatToken('tester', 3600, 'role-test-chat-secret')}`);
      expect(res.status).toBe(401);
    } finally {
      delete process.env.CHAT_JWT_SECRET;
    }
  });

  it('rejects disabled users with 401', async () => {
    userRepo().findUserById.mockResolvedValue({ ...adminRow, status: 'disabled' });
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Authorization', bearerFor());
    expect(res.status).toBe(401);
  });
});
