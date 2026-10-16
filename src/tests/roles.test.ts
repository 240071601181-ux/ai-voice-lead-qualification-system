/**
 * Phase 20 — internal roles (ADMIN | USER).
 *
 * - Public registration always mints USER, even if the caller knows the
 *   deployment's intended administrator email.
 * - requireRole: 401 without a valid internal user, 403 for insufficient
 *   role, pass for sufficient role; unknown stored roles normalize to
 *   USER (never a silent ADMIN).
 * - ADMIN-only writes (settings PATCH) reject USERs; reads stay open
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
    expect(normalizeRole('USER')).toBe('USER');
    expect(normalizeRole(undefined)).toBe('USER');
    expect(normalizeRole(null)).toBe('USER');
    expect(normalizeRole('admin')).toBe('USER');
    expect(normalizeRole('SUPERADMIN')).toBe('USER');
    expect(normalizeRole('')).toBe('USER');
  });
});

describe('controlled admin provisioning', () => {
  it('promotes only an explicitly selected active account through the deployment repository operation', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rowCount: 1, rows: [{ id: 'admin-user-1' }] });
    const promoted = await userRepo().promoteUserToAdmin('owner@example.com');
    expect(promoted).toBe(true);
    const [sql, values] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("SET role = 'ADMIN'");
    expect(sql).toContain("status = 'active'");
    expect(values).toEqual(['owner@example.com']);
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

  it('registers USER by default (never a silent ADMIN)', async () => {
    mockRegisterReads();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'new@example.com', password: 'password-123456', name: 'New User', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('USER');
    const insert = (pool.query as jest.Mock).mock.calls.find(([s]: string[]) =>
      String(s).includes('INSERT INTO users')
    );
    expect(String(insert[0])).toContain('role');
    expect(insert[1][3]).toBe('USER');
  });

  it('does not grant ADMIN when public signup matches the former bootstrap email', async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'boss@example.com';
    mockRegisterReads();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'boss@example.com', password: 'password-123456', name: 'Boss User', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('USER');
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

  it('rejects USER writes to ADMIN-only settings with 403', async () => {
    userRepo().findUserById.mockResolvedValue({ ...adminRow, id: 'operator-user-1', role: 'USER' });
    const res = await request(app)
      .patch('/api/v1/settings')
      .set('Authorization', bearerFor(operatorUser))
      .send({ workspace_name: 'MadLead Logistics' });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('lets USER read admin APIs', async () => {
    userRepo().findUserById.mockResolvedValue({ ...adminRow, id: 'operator-user-1', role: 'USER' });
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

  it('returns the server-verified role on /auth/me', async () => {
    userRepo().findUserById.mockResolvedValue({ ...adminRow, id: 'operator-user-1', role: 'USER' });
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', bearerFor(operatorUser));
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('USER');
    expect(res.body.data).not.toHaveProperty('password_hash');
    expect(res.body.data).not.toHaveProperty('refreshToken');
  });

  it('never lets a USER promote itself through profile updates', async () => {
    const stored = { ...adminRow, id: 'operator-user-1', name: 'Staff', role: 'USER' };
    userRepo().findUserById.mockResolvedValue(stored);
    (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE users SET name')) {
        return { rows: [{ ...stored, name: 'Staff Renamed' }] };
      }
      return { rows: [] };
    });
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', bearerFor(operatorUser))
      .send({ name: 'Staff Renamed', role: 'ADMIN' });
    expect(res.status).toBe(200);
    // The rename applied; the smuggled role was ignored — still USER.
    expect(res.body.data.name).toBe('Staff Renamed');
    expect(res.body.data.role).toBe('USER');
    const writes = (pool.query as jest.Mock).mock.calls.map(([s]: string[]) => String(s));
    expect(writes.some((s) => s.includes('UPDATE users SET role'))).toBe(false);
  });
});
