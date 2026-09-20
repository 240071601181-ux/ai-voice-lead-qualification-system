/**
 * Phase 12 – calendar endpoint tests (service reads mocked; no Google calls).
 *
 * Verifies the thin internal API: validation, explicit booking (201),
 * duplicate (200), busy (409), invalid slot (422), availability GET,
 * and booking GET (200/404).
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { bearerFor, INTERNAL_AUTH_SECRET, useInternalAuthSecret } from './helpers/internalAuth';
import {
  resetCalendarProviderForTests,
  setCalendarProviderForTests
} from '../services/calendar/calendarProvider';
import { MockCalendarProvider } from '../services/calendar/mockCalendarProvider';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

// Phase 20 — /api/v1/calendar is internal: ADMIN identity for every call.
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

describe('Calendar endpoints', () => {
  const OLD_ENV = process.env;

  const lead: any = { id: 'lead-1', name: 'Acme Logistics', phone: '+911234567890', email: 'ops@acme.example', status: 'NEW' };
  const call: any = { id: 'call-1', lead_id: 'lead-1', vapi_call_id: 'vapi-1', status: 'ended' };
  const state: any = { id: 's-1', call_id: 'call-1', lead_id: 'lead-1', pickup_location: 'Chennai', destination: 'Bengaluru' };
  const hot: any = { id: 'q-1', call_id: 'call-1', lead_id: 'lead-1', score: 85, tier: 'HOT' };
  // Phase 20 — slots float in the near future: hardcoded dates expire past
  // validation ("start must be in the future") as the day progresses.
  const slotStart = new Date(Date.now() + 2 * 3600_000);
  slotStart.setSeconds(0, 0);
  const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
  const toOffset = (d: Date): string => {
    const ist = new Date(d.getTime() + (5 * 60 + 30) * 60_000);
    return `${ist.toISOString().slice(0, 16)}:00+05:30`;
  };
  const slot = { start: toOffset(slotStart), end: toOffset(slotEnd) };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...OLD_ENV,
      AUTH_JWT_SECRET: INTERNAL_AUTH_SECRET,
      CALENDAR_ENABLED: 'true',
      CALENDAR_PROVIDER: 'mock',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_REFRESH_TOKEN: 'test-refresh-token',
      GOOGLE_CALENDAR_ID: 'primary',
      CALENDAR_AUTO_BOOK_TIERS: 'HOT,WARM'
    };
    setCalendarProviderForTests(new MockCalendarProvider());
  });

  afterEach(() => {
    resetCalendarProviderForTests();
  });

  let restoreAuth: (() => void) | null = null;
  beforeAll(() => {
    restoreAuth = useInternalAuthSecret();
  });
  afterAll(() => {
    restoreAuth?.();
    process.env = OLD_ENV;
  });
  afterAll(() => {
    restoreAuth?.();
  });

  const mockBookingReads = () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [call] })
      .mockResolvedValueOnce({ rows: [state] })
      .mockResolvedValueOnce({ rows: [hot] })
      .mockResolvedValueOnce({ rows: [lead] });
  };

  const authedGet = (url: string) => request(app).get(url).set('Authorization', bearerFor());
  const authedPost = (url: string) => request(app).post(url).set('Authorization', bearerFor());

  it('should reject unauthenticated booking requests with 401', async () => {
    const anon = await request(app).post('/api/v1/calendar/bookings').send({ ...slot });
    expect(anon.status).toBe(401);
  });

  it('should reject booking requests without identity or explicit slot', async () => {
    const noIdentity = await authedPost('/api/v1/calendar/bookings').send({ ...slot });
    expect(noIdentity.status).toBe(400);
    const noSlot = await authedPost('/api/v1/calendar/bookings').send({ callId: 'call-1' });
    expect(noSlot.status).toBe(400);
  });

  it('should book explicitly and return 201 with stored meeting details', async () => {
    mockBookingReads();
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'b-1', attempts: 1 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'b-1', status: 'booked', external_event_id: 'mock-event-1', meet_url: 'https://meet.google.com/mock-1' }]
      });

    const res = await authedPost('/api/v1/calendar/bookings').send({ callId: 'call-1', ...slot });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.meet_url).toBe('https://meet.google.com/mock-1');
    expect(res.body.data.external_event_id).toBe('mock-event-1');
  });

  it('should return 409 when the requested slot is busy', async () => {
    const provider = new MockCalendarProvider();
    // Overlap the dynamic slot so the busy path triggers deterministically.
    provider.busyWindows.push({
      start: new Date(slotStart.getTime() + 5 * 60_000).toISOString(),
      end: new Date(slotStart.getTime() + 25 * 60_000).toISOString(),
    });
    setCalendarProviderForTests(provider);
    mockBookingReads();
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'b-2', attempts: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'b-2', status: 'skipped_unavailable' }] });

    const res = await authedPost('/api/v1/calendar/bookings').send({ callId: 'call-1', ...slot });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('should return 422 for invalid slots without provider calls', async () => {
    const res = await authedPost('/api/v1/calendar/bookings')
      .send({ callId: 'call-1', start: slot.start, end: slot.start });
    expect(res.status).toBe(422);
  });

  it('should check availability and read bookings by id', async () => {

    const free = await authedGet('/api/v1/calendar/availability').query({ ...slot });
    expect(free.status).toBe(200);
    expect(free.body).toEqual({ success: true, data: { available: true } });

    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'b-9', status: 'booked', meet_url: 'https://meet.google.com/mock-9' }]
    });
    const found = await authedGet('/api/v1/calendar/bookings/b-9');
    expect(found.status).toBe(200);
    expect(found.body.data.meet_url).toBe('https://meet.google.com/mock-9');

    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    const missing = await authedGet('/api/v1/calendar/bookings/does-not-exist');
    expect(missing.status).toBe(404);
  });

  it('should report unconfigured booking with the truthful message (disabled + no_config)', async () => {
    const expected =
      'Calendar booking is not configured. Connect Google Calendar to create a meeting.';

    process.env = { ...OLD_ENV, AUTH_JWT_SECRET: INTERNAL_AUTH_SECRET, CALENDAR_ENABLED: 'false' };
    const disabled = await authedPost('/api/v1/calendar/bookings')
      .send({ callId: 'call-1', ...slot });
    expect(disabled.status).toBe(503);
    expect(disabled.body.error.message).toBe(expected);

    const disabledAvail = await authedGet('/api/v1/calendar/availability').query({ ...slot });
    expect(disabledAvail.status).toBe(503);
    expect(disabledAvail.body.error.message).toBe(expected);

    process.env = {
      ...OLD_ENV,
      AUTH_JWT_SECRET: INTERNAL_AUTH_SECRET,
      CALENDAR_ENABLED: 'true',
      CALENDAR_PROVIDER: 'mock',
      // Hermetic "unconfigured" simulation: a developer .env may carry real
      // Google credentials, which would (correctly) count as configured.
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GOOGLE_REFRESH_TOKEN: '',
      GOOGLE_CALENDAR_ID: '',
    };
    const noConfig = await authedPost('/api/v1/calendar/bookings')
      .send({ callId: 'call-1', ...slot });
    expect(noConfig.status).toBe(503);
    expect(noConfig.body.error.message).toBe(expected);
  });
});
