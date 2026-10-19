/**
 * Phase 12 – Google Calendar provider tests (googleapis mocked; no network,
 * no real credentials).
 */
import { GoogleCalendarProvider } from '../services/calendar/googleCalendarProvider';

const mockFreebusyQuery = jest.fn();
const mockEventsInsert = jest.fn();
const mockSetCredentials = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: mockSetCredentials }))
    },
    calendar: jest.fn().mockImplementation(() => ({
      freebusy: { query: mockFreebusyQuery },
      events: { insert: mockEventsInsert }
    }))
  }
}));

describe('GoogleCalendarProvider', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...OLD_ENV,
      CALENDAR_ENABLED: 'true',
      CALENDAR_PROVIDER: 'google',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_REFRESH_TOKEN: 'test-refresh-token',
      GOOGLE_CALENDAR_ID: 'primary'
    };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('should report free slots when freebusy has no busy windows', async () => {
    mockFreebusyQuery.mockResolvedValueOnce({
      data: { calendars: { primary: { busy: [] } } }
    });
    const result = await new GoogleCalendarProvider().checkAvailability({
      calendarId: 'primary',
      slot: { start: '2026-09-20T04:30:00.000Z', end: '2026-09-20T05:00:00.000Z', timezone: 'Asia/Kolkata' },
      timeoutMs: 1000
    });
    expect(result).toEqual({ available: true });
  });

  it('should report busy slots when freebusy lists overlaps', async () => {
    mockFreebusyQuery.mockResolvedValueOnce({
      data: { calendars: { primary: { busy: [{ start: '2026-09-20T04:30:00Z', end: '2026-09-20T05:00:00Z' }] } } }
    });
    const result = await new GoogleCalendarProvider().checkAvailability({
      calendarId: 'primary',
      slot: { start: '2026-09-20T04:30:00.000Z', end: '2026-09-20T05:00:00.000Z', timezone: 'Asia/Kolkata' },
      timeoutMs: 1000
    });
    expect(result).toEqual({ available: false });
  });

  it('should create events with Meet conference data keyed by the idempotency key', async () => {
    mockEventsInsert.mockResolvedValueOnce({
      data: { id: 'evt-123', hangoutLink: 'https://meet.google.com/abc-defg-hij' }
    });
    const result = await new GoogleCalendarProvider().createEvent({
      calendarId: 'primary',
      summary: 'Meeting with Acme',
      description: 'Route: Chennai → Bengaluru',
      attendees: [{ email: 'ops@acme.example', displayName: 'Acme' }],
      slot: { start: '2026-09-20T04:30:00.000Z', end: '2026-09-20T05:00:00.000Z', timezone: 'Asia/Kolkata' },
      idempotencyKey: 'cal:google:call-1',
      timeoutMs: 1000
    });
    expect(result).toEqual({
      externalEventId: 'evt-123',
      meetUrl: 'https://meet.google.com/abc-defg-hij'
    });
    const params = mockEventsInsert.mock.calls[0][0];
    expect(params.calendarId).toBe('primary');
    expect(params.conferenceDataVersion).toBe(1);
    expect(params.requestBody.conferenceData.createRequest.requestId).toBe('cal:google:call-1');
    expect(params.requestBody.conferenceData.createRequest.conferenceSolutionKey).toEqual({
      type: 'hangoutsMeet'
    });
  });

  it('should fall back to conference entry points when hangoutLink is absent', async () => {
    mockEventsInsert.mockResolvedValueOnce({
      data: {
        id: 'evt-124',
        conferenceData: {
          entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/xyz-1234-abc' }]
        }
      }
    });
    const result = await new GoogleCalendarProvider().createEvent({
      calendarId: 'primary',
      summary: 'Meeting',
      slot: { start: '2026-09-20T04:30:00.000Z', end: '2026-09-20T05:00:00.000Z', timezone: 'Asia/Kolkata' },
      idempotencyKey: 'cal:google:call-2',
      timeoutMs: 1000
    });
    expect(result.meetUrl).toBe('https://meet.google.com/xyz-1234-abc');
  });

  it('should mark 5xx responses retryable with a sanitized message', async () => {
    mockEventsInsert.mockRejectedValueOnce({
      code: 503,
      response: { status: 503, data: {} },
      message: 'Backend Error with test-refresh-token inside'
    });
    const err: any = await new GoogleCalendarProvider()
      .createEvent({
        calendarId: 'primary',
        summary: 'Meeting',
        slot: { start: '2026-09-20T04:30:00.000Z', end: '2026-09-20T05:00:00.000Z', timezone: 'Asia/Kolkata' },
        idempotencyKey: 'cal:google:call-3',
        timeoutMs: 1000
      })
      .catch((e) => e);
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(503);
    expect(String(err.message)).not.toContain('test-refresh-token');
  });

  it('should identify an OAuth invalid_grant without retrying or leaking secrets', async () => {
    mockFreebusyQuery.mockRejectedValueOnce({
      code: 400,
      response: {
        status: 400,
        data: { error: 'invalid_grant', error_description: 'Bad Request' }
      },
      message: 'invalid_grant test-refresh-token test-client-secret'
    });
    const err: any = await new GoogleCalendarProvider()
      .checkAvailability({
        calendarId: 'primary',
        slot: { start: '2026-09-20T04:30:00.000Z', end: '2026-09-20T05:00:00.000Z', timezone: 'Asia/Kolkata' },
        timeoutMs: 1000
      })
      .catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.reason).toBe('invalid_grant');
    expect(err.authFailed).toBe(true);
    expect(err.retryable).toBe(false);
    expect(String(err.message)).toContain('invalid_grant');
    expect(String(err.message)).not.toContain('test-refresh-token');
    expect(String(err.message)).not.toContain('test-client-secret');
  });

  it('should mark 4xx responses as non-retryable and fail fast without credentials', async () => {
    mockEventsInsert.mockRejectedValueOnce({
      code: 400,
      response: { status: 400, data: {} },
      message: 'Invalid request'
    });
    const err: any = await new GoogleCalendarProvider()
      .createEvent({
        calendarId: 'primary',
        summary: 'Meeting',
        slot: { start: '2026-09-20T04:30:00.000Z', end: '2026-09-20T05:00:00.000Z', timezone: 'Asia/Kolkata' },
        idempotencyKey: 'cal:google:call-4',
        timeoutMs: 1000
      })
      .catch((e) => e);
    expect(err.retryable).toBe(false);

    delete process.env.GOOGLE_REFRESH_TOKEN;
    const credErr: any = await new GoogleCalendarProvider()
      .checkAvailability({
        calendarId: 'primary',
        slot: { start: '2026-09-20T04:30:00.000Z', end: '2026-09-20T05:00:00.000Z', timezone: 'Asia/Kolkata' },
        timeoutMs: 1000
      })
      .catch((e) => e);
    expect(credErr.retryable).toBe(false);
    expect(String(credErr.message)).not.toContain('test-client-secret');
  });
});
