/**
 * Phase 12 – calendar booking service tests (DB pool mocked, provider injected).
 *
 * Verifies: explicit HOT booking + Meet URL storage, duplicate suppression,
 * COLD-tier suppression, busy-slot skip, invalid-slot handling (never using
 * required_date as a slot), failure containment (never throws), disabled
 * skip, secret redaction, and no unrelated lead writes.
 */
import { pool } from '../database';
import {
  resetCalendarProviderForTests,
  setCalendarProviderForTests,
  hashCalendarSlot
} from '../services/calendar/calendarProvider';
import {
  checkCalendarAvailability,
  sanitizeCalendarErrorMessage,
  requestCalendarBooking
} from '../services/calendar/calendarBookingService';
import { MockCalendarProvider } from '../services/calendar/mockCalendarProvider';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

describe('calendarBookingService', () => {
  const OLD_ENV = process.env;
  let mockProvider: MockCalendarProvider;

  const lead: any = {
    id: 'lead-1',
    source: 'web',
    name: 'Acme Logistics',
    phone: '+911234567890',
    email: 'ops@acme.example',
    status: 'NEW'
  };
  const call: any = {
    id: 'call-1',
    lead_id: 'lead-1',
    vapi_call_id: 'vapi-1',
    status: 'ended',
    ended_at: '2026-09-11T10:05:00.000Z',
    duration_seconds: 300
  };
  const state: any = {
    id: 'state-1',
    call_id: 'call-1',
    lead_id: 'lead-1',
    pickup_location: 'Chennai',
    destination: 'Bengaluru',
    required_date: '2026-09-13',
    booking_intent: 'explicit'
  };
  const hotQualification: any = {
    id: 'qual-1',
    call_id: 'call-1',
    lead_id: 'lead-1',
    score: 85,
    tier: 'HOT',
    qualified_at: '2026-09-11T10:06:00.000Z'
  };

  const slotStart = new Date(Date.now() + 2 * 3600_000);
  slotStart.setSeconds(0, 0);
  const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
  // Phase 20 — slots float in the near future: hardcoded dates expire past
  // validation ("start must be in the future") as the day progresses.
  const slotInput = {
    start: slotStart.toISOString(),
    end: slotEnd.toISOString(),
  };

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
      CALENDAR_TIMEZONE: 'Asia/Kolkata',
      CALENDAR_AUTO_BOOK_TIERS: 'HOT,WARM'
    };
    mockProvider = new MockCalendarProvider();
    setCalendarProviderForTests(mockProvider);
  });

  afterEach(() => {
    resetCalendarProviderForTests();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  const mockReads = (overrides: { qualification?: any; state?: any; lead?: any } = {}) => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [call] }) // findCallById
      .mockResolvedValueOnce({ rows: [overrides.state !== undefined ? overrides.state : state] })
      .mockResolvedValueOnce({
        rows: [overrides.qualification !== undefined ? overrides.qualification : hotQualification]
      })
      .mockResolvedValueOnce({ rows: [overrides.lead !== undefined ? overrides.lead : lead] });
  };

  it('should book a HOT lead on an explicit slot and store event ID + Meet URL', async () => {
    mockReads();
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] }) // findBookingByKey -> none
      .mockResolvedValueOnce({ rows: [{ id: 'b-1', attempts: 1 }] }) // upsert attempt
      .mockResolvedValueOnce({ rows: [{ id: 'b-1', status: 'booked' }] }); // mark booked

    const outcome = await requestCalendarBooking({ callId: 'call-1', ...slotInput });
    expect(outcome.ok).toBe(true);
    expect(outcome.created).toBe(true);
    expect(mockProvider.availabilityCalls).toHaveLength(1);
    expect(mockProvider.bookingCalls).toHaveLength(1);
    expect(mockProvider.bookingCalls[0].idempotencyKey).toBe('cal:mock:call-1');
    expect(mockProvider.bookingCalls[0].summary).toContain('Acme Logistics');
    const statements = (pool.query as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(statements.some((s) => /UPDATE\s+leads/i.test(s))).toBe(false);
  });

  it('should return the stored meeting without a provider call on duplicate requests', async () => {
    const slotHash = hashCalendarSlot({
      start: slotInput.start,
      end: slotInput.end,
      timezone: 'Asia/Kolkata'
    });
    mockReads();
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{
        id: 'b-1',
        status: 'booked',
        slot_hash: slotHash,
        external_event_id: 'mock-event-1',
        meet_url: 'https://meet.google.com/mock-1'
      }]
    });

    const outcome = await requestCalendarBooking({ callId: 'call-1', ...slotInput });
    expect(outcome.ok).toBe(true);
    expect(outcome.duplicate).toBe(true);
    expect(outcome.booking?.meet_url).toBe('https://meet.google.com/mock-1');
    expect(mockProvider.bookingCalls).toHaveLength(0);
  });

  it('should suppress COLD tiers without provider calls', async () => {
    mockReads({ qualification: { ...hotQualification, tier: 'COLD', score: 10 } });
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 'b-2', attempts: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'b-2', status: 'skipped_tier' }] });

    const outcome = await requestCalendarBooking({ callId: 'call-1', ...slotInput });
    expect(outcome).toMatchObject({ ok: false, skipped: 'tier' });
    expect(mockProvider.availabilityCalls).toHaveLength(0);
    expect(mockProvider.bookingCalls).toHaveLength(0);
  });

  it('should skip busy slots without creating events', async () => {
    mockProvider.busyWindows.push({
      start: new Date(new Date(slotInput.start).getTime() + 5 * 60_000).toISOString(),
      end: new Date(new Date(slotInput.start).getTime() + 25 * 60_000).toISOString(),
    });
    mockReads();
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'b-3', attempts: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'b-3', status: 'skipped_unavailable' }] });

    const outcome = await requestCalendarBooking({ callId: 'call-1', ...slotInput });
    expect(outcome).toMatchObject({ ok: false, skipped: 'unavailable' });
    expect(mockProvider.bookingCalls).toHaveLength(0);
  });

  it('should reject invalid slots without touching the provider or required_date', async () => {
    // required_date alone (no explicit end) must never become a booking.
    const noEnd = await requestCalendarBooking({ callId: 'call-1', start: '2026-09-13' } as any);
    expect(noEnd).toEqual({ ok: false, skipped: 'invalid_slot' });
    const backwards = await requestCalendarBooking({
      callId: 'call-1',
      start: '2026-09-20T11:00:00+05:30',
      end: '2026-09-20T10:30:00+05:30'
    });
    expect(backwards).toEqual({ ok: false, skipped: 'invalid_slot' });
    expect(mockProvider.availabilityCalls).toHaveLength(0);
    expect(mockProvider.bookingCalls).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('should contain provider failures: record failed row and resolve (never throw)', async () => {
    mockProvider.enqueue({ error: Object.assign(new Error('calendar down'), { retryable: false }) });
    mockReads();
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] }) // findBookingByKey
      .mockResolvedValueOnce({ rows: [{ id: 'b-4', attempts: 1 }] }) // upsert
      .mockResolvedValueOnce({ rows: [{ id: 'b-4', attempts: 2 }] }) // upsert (error path)
      .mockResolvedValueOnce({ rows: [{ id: 'b-4', status: 'failed' }] }); // mark failed

    const outcome = await requestCalendarBooking({ callId: 'call-1', ...slotInput });
    expect(outcome.ok).toBe(false);
    await expect(Promise.resolve(outcome)).resolves.toBeDefined();
    const failedCall = (pool.query as jest.Mock).mock.calls.find((c) =>
      /status = 'failed'/i.test(String(c[0]))
    );
    expect(failedCall).toBeDefined();
    expect(failedCall[1]).toEqual(expect.arrayContaining(['calendar down']));
  });

  it('should skip silently when disabled and redact secrets from errors', async () => {
    process.env.CALENDAR_ENABLED = 'false';
    const outcome = await requestCalendarBooking({ callId: 'call-1', ...slotInput });
    expect(outcome).toEqual({ ok: false, skipped: 'disabled' });
    expect(mockProvider.bookingCalls).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();

    const message = sanitizeCalendarErrorMessage(
      new Error('auth failed refresh_token=test-refresh-token for calendar')
    );
    expect(message).not.toContain('test-refresh-token');
  });

  it('should check availability independently of booking', async () => {
    const free = await checkCalendarAvailability({ ...slotInput });
    expect(free).toEqual({ ok: true, available: true });
    const invalid = await checkCalendarAvailability({ start: 'nope', end: 'also-nope' });
    expect(invalid).toEqual({ ok: false, skipped: 'invalid_slot' });
  });
});
