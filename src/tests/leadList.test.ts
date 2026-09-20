/**
 * GET /api/v1/leads list endpoint tests (pool mocked).
 *
 * Covers: default paginated list with total, explicit pagination
 * (LIMIT/OFFSET params), search filtering (ILIKE on both queries),
 * invalid query params (400), and empty results.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { bearerFor, useInternalAuthSecret } from './helpers/internalAuth';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

// Phase 20 — /api/v1/leads is internal: every request carries an ADMIN
// identity (userRepository is stubbed so pool-call assertions stay exact).
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

describe('GET /api/v1/leads', () => {
  const lead: any = {
    id: 'lead-1',
    source: 'web',
    name: 'Arjun Rao',
    phone: '+919876522109',
    email: 'arjun@raoexports.in',
    status: 'NEW',
    created_at: '2026-09-12T09:00:00.000Z',
    updated_at: '2026-09-12T09:00:00.000Z',
  };

  const mockListReads = (rows: any[], total: string | number) => {
    (pool.query as jest.Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (/COUNT\(\*\)/.test(s)) return Promise.resolve({ rows: [{ total: String(total) }] });
      if (/FROM leads/.test(s)) return Promise.resolve({ rows });
      return Promise.resolve({ rows: [] });
    });
  };

  const selectCall = () =>
    (pool.query as jest.Mock).mock.calls.find((call: any[]) => /FROM leads/.test(String(call[0])) && !/COUNT/.test(String(call[0])));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  let restoreAuth: (() => void) | null = null;
  beforeAll(() => {
    restoreAuth = useInternalAuthSecret();
  });
  afterAll(() => {
    restoreAuth?.();
  });

  const authedGet = (url: string) =>
    request(app).get(url).set('Authorization', bearerFor());

  it('returns paginated leads with total by default (page 1, limit 20)', async () => {
    mockListReads([lead], 1);
    const res = await authedGet('/api/v1/leads');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(res.body.data.leads).toHaveLength(1);
    expect(res.body.data.leads[0]).toMatchObject({ id: 'lead-1', status: 'NEW' });

    const call = selectCall();
    expect(call[0]).toContain('ORDER BY created_at DESC');
    expect(call[1]).toEqual([20, 0]);
  });

  it('honors explicit page/limit via LIMIT/OFFSET', async () => {
    mockListReads([lead], 42);
    const res = await authedGet('/api/v1/leads').query({ page: '3', limit: '5' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 42, page: 3, limit: 5 });
    expect(selectCall()[1]).toEqual([5, 10]);
  });

  it('applies search as ILIKE on the select and count queries', async () => {
    mockListReads([lead], 1);
    const res = await authedGet('/api/v1/leads').query({ search: 'arjun' });

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    for (const call of (pool.query as jest.Mock).mock.calls) {
      expect(String(call[0])).toContain('ILIKE');
      expect(call[1][0]).toBe('%arjun%');
    }
  });

  it('rejects invalid pagination params with 400', async () => {
    for (const query of [{ page: '0' }, { page: 'abc' }, { limit: '0' }, { limit: '101' }, { limit: 'abc' }]) {
      const res = await authedGet('/api/v1/leads').query(query);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns an empty list with total 0 when nothing matches', async () => {
    mockListReads([], 0);
    const res = await authedGet('/api/v1/leads').query({ search: 'no-such-lead' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ total: 0, page: 1, limit: 20, leads: [] });
  });
});
