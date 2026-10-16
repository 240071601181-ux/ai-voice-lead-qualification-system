/**
 * Phase 4 — dashboard summary (GET /api/v1/dashboard/summary).
 *
 * Proves the dashboard cards feed on bounded SQL COUNT aggregates (no row
 * fetching), that conversation counts are scoped to the requesting user
 * (same ownership rule as the conversations list), that unknown tiers and
 * statuses are ignored, and that empty tables yield zeros — never invented
 * values. Auth untouched: ADMIN and USER may read, anonymous gets 401.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { bearerFor, operatorUser, useInternalAuthSecret } from './helpers/internalAuth';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

// Phase 20 — /api/v1/dashboard is internal: identity per test via bearerFor.
jest.mock('../repositories/userRepository', () => {
  const actual = jest.requireActual('../repositories/userRepository');
  const byId: Record<string, unknown> = {};
  return {
    ...actual,
    findUserById: jest.fn(async (id: string) => byId[id] ?? null),
    __setUsers: (users: Record<string, unknown>) => {
      for (const k of Object.keys(byId)) delete byId[k];
      Object.assign(byId, users);
    },
  };
});

const { __setUsers } = jest.requireMock('../repositories/userRepository') as {
  __setUsers: (users: Record<string, unknown>) => void;
};

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

const operatorRow = {
  ...adminRow,
  id: operatorUser.id,
  email: operatorUser.email,
  name: operatorUser.name,
  role: 'USER',
};

describe('dashboard summary', () => {
  let restoreAuth: (() => void) | null = null;
  beforeAll(() => {
    restoreAuth = useInternalAuthSecret();
  });
  afterAll(() => {
    restoreAuth?.();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    __setUsers({ [adminRow.id]: adminRow, [operatorRow.id]: operatorRow });
  });

  const mockSummaryQueries = (overrides: Record<string, Array<{ n?: number; status?: string; tier?: string }>> = {}) => {
    (pool.query as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('scheduled_start > NOW()')) {
        return Promise.resolve({ rows: overrides.upcoming ?? [{ n: 2 }] });
      }
      if (sql.includes('FROM leads')) {
        return Promise.resolve({ rows: overrides.leads ?? [{ n: 7 }] });
      }
      if (sql.includes('FROM conversations')) {
        return Promise.resolve({
          rows: overrides.conversations ?? [
            { status: 'active', n: 3 },
            { status: 'completed', n: 4 },
            { status: 'abandoned', n: 1 },
            { status: 'MYSTERY', n: 99 },
          ],
        });
      }
      if (sql.includes('FROM follow_ups')) {
        return Promise.resolve({
          rows: overrides.followups ?? [
            { status: 'pending', n: 2 },
            { status: 'processing', n: 1 },
            { status: 'completed', n: 5 },
            { status: 'failed', n: 1 },
            { status: 'cancelled', n: 1 },
          ],
        });
      }
      if (sql.includes('FROM calendar_bookings')) {
        return Promise.resolve({ rows: overrides.bookings ?? [{ n: 6 }] });
      }
      if (sql.includes('GROUP BY tier')) {
        return Promise.resolve({
          rows: overrides.mix ?? [
            { tier: 'HOT', n: 2 },
            { tier: 'WARM', n: 1 },
            { tier: 'COLD', n: 1 },
            { tier: 'MYSTERY', n: 99 },
          ],
        });
      }
      throw new Error(`unexpected query: ${sql}`);
    });
  };

  it('returns bounded aggregates and scopes conversations to the caller', async () => {
    mockSummaryQueries();
    const res = await request(app)
      .get('/api/v1/dashboard/summary')
      .set('Authorization', bearerFor());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      leads: { total: 7 },
      qualifications: { total: 4, hot: 2, warm: 1, cold: 1 },
      conversations: { total: 8, active: 3, completed: 4, abandoned: 1 },
      followups: { total: 10, pending: 2, processing: 1, completed: 5, failed: 1, cancelled: 1 },
      bookings: { total: 6, upcoming: 2 },
    });
    const convCall = (pool.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
      sql.includes('FROM conversations')
    );
    expect(convCall?.[1]).toEqual(['admin-user-1']);
  });

  it('returns zeros on empty tables', async () => {
    mockSummaryQueries({
      leads: [{ n: 0 }],
      conversations: [],
      followups: [],
      bookings: [{ n: 0 }],
      upcoming: [{ n: 0 }],
      mix: [],
    });
    const res = await request(app)
      .get('/api/v1/dashboard/summary')
      .set('Authorization', bearerFor());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      leads: { total: 0 },
      qualifications: { total: 0, hot: 0, warm: 0, cold: 0 },
      conversations: { total: 0, active: 0, completed: 0, abandoned: 0 },
      followups: { total: 0, pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 },
      bookings: { total: 0, upcoming: 0 },
    });
  });

  it('allows USER role reads with their own conversation scope', async () => {
    mockSummaryQueries({ conversations: [{ status: 'active', n: 1 }] });
    const res = await request(app)
      .get('/api/v1/dashboard/summary')
      .set('Authorization', bearerFor(operatorUser));
    expect(res.status).toBe(200);
    expect(res.body.data.conversations).toEqual({
      total: 1,
      active: 1,
      completed: 0,
      abandoned: 0,
    });
    const convCall = (pool.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
      sql.includes('FROM conversations')
    );
    expect(convCall?.[1]).toEqual([operatorUser.id]);
  });

  it('rejects anonymous requests', async () => {
    const res = await request(app).get('/api/v1/dashboard/summary');
    expect(res.status).toBe(401);
  });
});
