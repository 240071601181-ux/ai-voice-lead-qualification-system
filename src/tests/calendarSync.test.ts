/**
 * Calendar sync endpoints tests (pool + provider mocked).
 *
 * Covers: sync-status with no prior run (null), successful sync run
 * persisting state, failed sync run (unconfigured calendar) persisting a
 * failed state with a safe message, and availability with minute-precision
 * datetimes (backend compatibility for step=60 inputs).
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import {
  resetCalendarProviderForTests,
  setCalendarProviderForTests
} from '../services/calendar/calendarProvider';
import { MockCalendarProvider } from '../services/calendar/mockCalendarProvider';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

describe('Calendar sync endpoints', () => {
  const OLD_ENV = process.env;

  const persisted = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    status: 'success',
    last_sync_at: '2026-09-12T10:00:00.000Z',
    message: 'Calendar connected · probe window is free',
    created_at: '2026-09-12T10:00:00.000Z',
    updated_at: '2026-09-12T10:00:00.000Z',
    ...overrides
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...OLD_ENV,
      CALENDAR_ENABLED: 'true',
      CALENDAR_PROVIDER: 'mock',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_REFRESH_TOKEN: 'test-refresh-token',
      GOOGLE_CALENDAR_ID: 'primary',
      CALENDAR_TIMEZONE: 'Asia/Kolkata'
    };
    setCalendarProviderForTests(new MockCalendarProvider());
  });

  afterEach(() => {
    resetCalendarProviderForTests();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('returns a null sync state when no sync has ever run', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/v1/calendar/sync-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
  });

  it('runs a real probe, persists success, and returns it', async () => {
    (pool.query as jest.Mock).mockImplementation((sql: string) => {
      if (/INSERT INTO calendar_sync_state/.test(String(sql))) {
        return Promise.resolve({ rows: [persisted()] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post('/api/v1/calendar/sync').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ status: 'success' });
    expect(res.body.data.last_sync_at).toBeDefined();
    expect(res.body.data.message).toContain('Calendar connected');
    const insert = (pool.query as jest.Mock).mock.calls.find((call: any[]) =>
      /INSERT INTO calendar_sync_state/.test(String(call[0]))
    );
    expect(insert).toBeDefined();
    expect(insert[1][0]).toBe('success');
  });

  it('persists a failed state with a safe message when unconfigured', async () => {
    process.env = { ...OLD_ENV, CALENDAR_ENABLED: 'true', CALENDAR_PROVIDER: 'mock' };
    (pool.query as jest.Mock).mockImplementation((sql: string) => {
      if (/INSERT INTO calendar_sync_state/.test(String(sql))) {
        return Promise.resolve({
          rows: [persisted({ status: 'failed', message: 'Calendar is not configured (Google OAuth credentials missing)' })]
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post('/api/v1/calendar/sync').send({});
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('Calendar is not configured');
    expect(res.body.data).toMatchObject({ status: 'failed' });
  });

  it('accepts minute-precision datetimes on availability checks', async () => {
    const res = await request(app)
      .get('/api/v1/calendar/availability')
      .query({ start: '2026-09-20T10:00:00+05:30', end: '2026-09-20T10:30:00+05:30' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { available: true } });
  });

  it('reports truthful diagnostics when disabled (no secrets, connectivity skipped)', async () => {
    process.env = { ...OLD_ENV, CALENDAR_ENABLED: 'false' };
    (pool.query as jest.Mock).mockImplementation((sql: string) => {
      if (/FROM calendar_sync_state|FROM calendar_bookings/.test(String(sql))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [{ '?column?': 1 }] });
    });
    const res = await request(app).get('/api/v1/calendar/diagnostics');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('not_configured');
    const byName: Record<string, any> = Object.fromEntries(
      res.body.data.checks.map((c: any) => [c.name, c])
    );
    expect(byName.enabled.status).toBe('failed');
    expect(byName.connectivity.status).toBe('skipped');
    expect(byName.database.status).toBe('ok');
    // Secrets must never appear, even as redacted markers of real values.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('test-client-secret');
    expect(body).not.toContain('test-refresh-token');
  });

  it('reports ok diagnostics when fully configured with a working provider', async () => {
    (pool.query as jest.Mock).mockImplementation((sql: string) => {
      if (/FROM calendar_sync_state|FROM calendar_bookings/.test(String(sql))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [{ '?column?': 1 }] });
    });
    const res = await request(app).get('/api/v1/calendar/diagnostics');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.checks.map((c: any) => c.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('test-client-secret');
    expect(body).not.toContain('test-refresh-token');
  });

  it('reports database failure without leaking internals', async () => {
    (pool.query as jest.Mock).mockRejectedValueOnce(new Error('connect failed test-client-secret boom'));
    const res = await request(app).get('/api/v1/calendar/diagnostics');
    expect(res.status).toBe(200);
    const byName: Record<string, any> = Object.fromEntries(
      res.body.data.checks.map((c: any) => [c.name, c])
    );
    expect(byName.database.status).toBe('failed');
    expect(JSON.stringify(res.body)).not.toContain('test-client-secret');
  });
});
