import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { MockCalendarProvider } from '../services/calendar/mockCalendarProvider';
import {
  resetCalendarProviderForTests,
  setCalendarProviderForTests,
} from '../services/calendar/calendarProvider';
import { requestCalendarBooking } from '../services/calendar/calendarBookingService';
import {
  dispatchConversationTool,
  executeCheckCalendarAvailabilityText,
  executeScheduleMeetingText,
  isTextToolName,
} from '../agent/conversationTools';
import { MockN8nClient } from '../services/n8n/mockN8nClient';
import { resetN8nClientForTests, setN8nClientForTests } from '../services/n8n/n8nClient';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const TEST_SECRET = 'phase8-test-secret-do-not-use-in-prod';
const futureIso = (hoursFromNow: number, minutes = 0): string =>
  new Date(Date.now() + hoursFromNow * 3600 * 1000 + minutes * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// In-memory fake backend.
// ---------------------------------------------------------------------------
interface Store {
  convo: any;
  leadRow: any;
  textState: any;
  convQual: any;
  callRow: any;
  callState: any;
  callQual: any;
  bookingsByKey: Map<string, any>;
  n8nByKey: Map<string, any>;
  seq: number;
}

const makeStore = (): Store => ({
  convo: {
    id: 'conv-1',
    lead_id: 'lead-1',
    channel: 'web',
    status: 'active',
    started_at: new Date().toISOString(),
    ended_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  leadRow: {
    id: 'lead-1',
    name: 'Arun',
    phone: '+911234567890',
    email: 'arun@example.com',
    source: 'web',
    status: 'NEW',
  },
  textState: {
    id: 'st-1',
    conversation_id: 'conv-1',
    lead_id: 'lead-1',
    customer_name: 'Arun',
    pickup_location: 'Chennai',
    destination: 'Bengaluru',
    vehicle_type: 'Truck',
    required_date: '2026-12-25',
    budget: 15000,
  },
  convQual: null,
  callRow: null,
  callState: null,
  callQual: null,
  bookingsByKey: new Map(),
  n8nByKey: new Map(),
  seq: 0,
});

const installMock = (store: Store) => {
  (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
    if (sql.startsWith('UPDATE calendar_bookings')) {
      const row = [...store.bookingsByKey.values()].find((r) => r.id === params[0]);
      if (!row) return { rows: [] };
      const statusLiteral = sql.match(/SET status = '([a-z_]+)'/);
      if (statusLiteral) row.status = statusLiteral[1];
      else if (sql.includes('status = $2')) row.status = params[1];
      if (/external_event_id/.test(sql)) {
        row.external_event_id = params[1];
        row.meet_url = params[2];
      }
      if (/last_error/.test(sql) && typeof params[1] === 'string') row.last_error = params[1];
      row.updated_at = new Date().toISOString();
      return { rows: [row] };
    }
    if (sql.includes('SELECT * FROM conversations WHERE id')) {
      return { rows: store.convo && store.convo.id === params[0] ? [store.convo] : [] };
    }
    if (sql.includes('UPDATE conversations SET status')) {
      store.convo = { ...store.convo, status: params[0] };
      return { rows: [store.convo] };
    }
    if (sql.includes('FROM conversation_states')) {
      return {
        rows: store.textState && store.textState.conversation_id === params[0] ? [store.textState] : [],
      };
    }
    if (sql.includes('FROM qualifications WHERE conversation_id')) {
      return {
        rows: store.convQual && store.convQual.conversation_id === params[0] ? [store.convQual] : [],
      };
    }
    if (sql.includes('FROM conversation_state WHERE call_id')) {
      return { rows: store.callState && store.callState.call_id === params[0] ? [store.callState] : [] };
    }
    if (sql.includes('FROM qualifications WHERE call_id')) {
      return { rows: store.callQual && store.callQual.call_id === params[0] ? [store.callQual] : [] };
    }
    if (sql.includes('FROM calls WHERE id')) {
      return { rows: store.callRow && store.callRow.id === params[0] ? [store.callRow] : [] };
    }
    if (sql.includes('FROM leads WHERE id')) {
      return { rows: store.leadRow && store.leadRow.id === params[0] ? [store.leadRow] : [] };
    }
    if (sql.includes('INSERT INTO calendar_bookings')) {
      const [
        booking_key, lead_id, call_id, conversation_id, qualification_id,
        provider, calendar_id, scheduled_start, scheduled_end, timezone, slot_hash,
      ] = params;
      const prev = store.bookingsByKey.get(booking_key);
      const row = {
        id: prev?.id ?? `bk-${++store.seq}`,
        booking_key, lead_id, call_id, conversation_id, qualification_id, provider,
        calendar_id, external_event_id: prev?.external_event_id ?? null,
        meet_url: prev?.meet_url ?? null,
        scheduled_start, scheduled_end, timezone,
        status: 'pending',
        attempts: (prev?.attempts ?? 0) + 1,
        slot_hash,
        last_error: null,
        created_at: prev?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.bookingsByKey.set(booking_key, row);
      return { rows: [row] };
    }
    if (sql.includes('FROM calendar_bookings WHERE booking_key')) {
      const row = store.bookingsByKey.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('INSERT INTO n8n_deliveries')) {
      const [event, event_id, workflow, discriminator, lead_id, call_id, qualification_id, payload_hash] = params;
      const key = `${event_id}::${workflow}`;
      const prev = store.n8nByKey.get(key);
      const row = {
        id: prev?.id ?? `n8n-${++store.seq}`,
        event, event_id, workflow, discriminator, lead_id, call_id, qualification_id,
        status: 'pending',
        attempts: (prev?.attempts ?? 0) + 1,
        payload_hash,
        http_status: null,
        last_error: null,
        created_at: prev?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.n8nByKey.set(key, row);
      return { rows: [row] };
    }
    if (sql.includes('FROM n8n_deliveries WHERE event_id')) {
      const row = store.n8nByKey.get(`${params[0]}::${params[1]}`);
      return { rows: row ? [row] : [] };
    }
    return { rows: [] };
  });
};

describe('Phase 8: Conversation-Based Meeting Scheduling', () => {
  const OLD_ENV = process.env;
  let calendar: MockCalendarProvider;
  let n8n: MockN8nClient;

  beforeEach(() => {
    jest.clearAllMocks();
    resetChatRateLimitsForTests();
    process.env = {
      ...OLD_ENV,
      CHAT_JWT_SECRET: TEST_SECRET,
      CHAT_RATE_LIMIT_MAX: '1000',
      CHAT_MESSAGE_RATE_LIMIT_MAX: '1000',
      CHAT_MAX_MESSAGE_LENGTH: '4000',
      LLM_PROVIDER: 'mock',
      CALENDAR_ENABLED: 'true',
      CALENDAR_PROVIDER: 'mock',
      GOOGLE_CLIENT_ID: 'cid',
      GOOGLE_CLIENT_SECRET: 'c-secret',
      GOOGLE_REFRESH_TOKEN: 'r-token',
      GOOGLE_CALENDAR_ID: 'primary',
      CALENDAR_TIMEZONE: 'Asia/Kolkata',
      CALENDAR_MAX_RETRIES: '0',
      N8N_ENABLED: 'false',
    };
    calendar = new MockCalendarProvider();
    setCalendarProviderForTests(calendar);
    n8n = new MockN8nClient();
    setN8nClientForTests(n8n);
  });

  afterEach(() => {
    resetCalendarProviderForTests();
    resetN8nClientForTests();
    process.env = OLD_ENV;
  });

  const auth = (sub = 'tester') => `Bearer ${signChatToken(sub)}`;
  const slot = (startH: number, durationMin = 30) => ({
    start: futureIso(startH),
    end: futureIso(startH, durationMin),
    timezone: 'Asia/Kolkata',
  });

  // ---------------------------------------------------------------
  // Availability
  // ---------------------------------------------------------------
  describe('availability endpoint', () => {
    it('returns availability for an explicit slot', async () => {
      const store = makeStore();
      installMock(store);
      const s = slot(24);
      const res = await request(app)
        .get(`/api/v1/conversations/conv-1/calendar/availability?start=${encodeURIComponent(s.start)}&end=${encodeURIComponent(s.end)}&timezone=Asia%2FKolkata`)
        .set('Authorization', auth());
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ available: true });
      expect(calendar.availabilityCalls).toHaveLength(1);
    });

    it('reports busy slots without provider internals', async () => {
      const store = makeStore();
      installMock(store);
      const s = slot(24);
      calendar.busyWindows.push({ start: s.start, end: s.end });
      const res = await request(app)
        .get(`/api/v1/conversations/conv-1/calendar/availability?start=${encodeURIComponent(s.start)}&end=${encodeURIComponent(s.end)}`)
        .set('Authorization', auth());
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ available: false });
    });

    it('rejects missing slot, bad dates, unknown/abandoned conversations, and requires auth', async () => {
      const store = makeStore();
      installMock(store);
      const missing = await request(app)
        .get('/api/v1/conversations/conv-1/calendar/availability?start=x')
        .set('Authorization', auth());
      expect(missing.status).toBe(400);

      const s = slot(24);
      const bad = await request(app)
        .get(`/api/v1/conversations/conv-1/calendar/availability?start=not-a-date&end=${encodeURIComponent(s.end)}`)
        .set('Authorization', auth());
      expect(bad.status).toBe(422);

      store.convo = null;
      const gone = await request(app)
        .get(`/api/v1/conversations/conv-missing/calendar/availability?start=${encodeURIComponent(s.start)}&end=${encodeURIComponent(s.end)}`)
        .set('Authorization', auth());
      expect(gone.status).toBe(404);

      const unauth = await request(app).get(
        `/api/v1/conversations/conv-1/calendar/availability?start=${encodeURIComponent(s.start)}&end=${encodeURIComponent(s.end)}`
      );
      expect(unauth.status).toBe(401);
    });

    it('surfaces disabled/unconfigured calendar truthfully', async () => {
      const store = makeStore();
      installMock(store);
      const s = slot(24);
      const q = `start=${encodeURIComponent(s.start)}&end=${encodeURIComponent(s.end)}`;
      process.env.CALENDAR_ENABLED = 'false';
      const disabled = await request(app)
        .get(`/api/v1/conversations/conv-1/calendar/availability?${q}`)
        .set('Authorization', auth());
      expect(disabled.status).toBe(503);
      expect(disabled.body.error.message).toContain('not configured');

      process.env.CALENDAR_ENABLED = 'true';
      delete process.env.GOOGLE_REFRESH_TOKEN;
      const noConfig = await request(app)
        .get(`/api/v1/conversations/conv-1/calendar/availability?${q}`)
        .set('Authorization', auth());
      expect(noConfig.status).toBe(503);
    });
  });

  // ---------------------------------------------------------------
  // Booking
  // ---------------------------------------------------------------
  describe('booking endpoint', () => {
    it('books an explicit slot with Meet details and conversation anchor', async () => {
      const store = makeStore();
      installMock(store);
      const s = slot(24);
      const res = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send({ ...s, title: 'Logistics discussion' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        lead_id: 'lead-1',
        call_id: null,
        conversation_id: 'conv-1',
        status: 'booked',
      });
      expect(res.body.data.meet_url).toContain('https://meet.google.com/mock-');
      expect(res.body.data.external_event_id).toBe('mock-event-1');
      const row = store.bookingsByKey.get('cal:mock:conv:conv-1');
      expect(row.status).toBe('booked');
      expect(calendar.bookingCalls).toHaveLength(1);
      // Idempotency key doubles as the Meet requestId.
      expect(calendar.bookingCalls[0].idempotencyKey).toBe('cal:mock:conv:conv-1');
    });

    it('is idempotent: same request twice returns the stored meeting without a new event', async () => {
      const store = makeStore();
      installMock(store);
      const s = slot(24);
      const first = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send(s);
      const second = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send(s);
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(calendar.bookingCalls).toHaveLength(1);
    });

    it('rejects busy slots (409), past slots (422), and missing times (400)', async () => {
      const store = makeStore();
      installMock(store);
      const s = slot(24);
      calendar.busyWindows.push({ start: s.start, end: s.end });
      const busy = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send(s);
      expect(busy.status).toBe(409);
      expect(calendar.bookingCalls).toHaveLength(0);

      const past = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send({ start: '2020-01-01T10:00:00.000Z', end: '2020-01-01T10:30:00.000Z' });
      expect(past.status).toBe(422);

      const missing = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send({ timezone: 'Asia/Kolkata' });
      expect(missing.status).toBe(400);
    });

    it('never infers meeting time from required_date and ignores forged leadId', async () => {
      const store = makeStore();
      installMock(store);
      // State carries required_date 2026-12-25, but no explicit slot → 400.
      const noSlot = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send({ leadId: 'lead-evil', notes: 'use my required date' });
      expect(noSlot.status).toBe(400);
      expect(calendar.bookingCalls).toHaveLength(0);

      // Forged leadId alongside an explicit slot is ignored: trusted lead wins.
      const s = slot(48);
      const forged = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send({ ...s, leadId: 'lead-evil', callId: 'call-evil' });
      expect(forged.status).toBe(201);
      expect(forged.body.data.lead_id).toBe('lead-1');
      expect(forged.body.data.call_id).toBeNull();
    });

    it('fails safe without a linked lead and on abandoned conversations', async () => {
      const store = makeStore();
      store.convo.lead_id = null;
      installMock(store);
      const s = slot(24);
      const noLead = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send(s);
      expect(noLead.status).toBe(422);
      expect(calendar.bookingCalls).toHaveLength(0);

      store.convo.lead_id = 'lead-1';
      store.convo.status = 'abandoned';
      const dropped = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send(s);
      expect(dropped.status).toBe(409);
    });

    it('sanitizes provider errors and surfaces disabled state truthfully', async () => {
      const store = makeStore();
      installMock(store);
      calendar.enqueue({ error: new Error('google blew up c-secret r-token') });
      const s = slot(24);
      const failed = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send(s);
      expect(failed.status).toBe(502);
      const body = JSON.stringify(failed.body);
      expect(body).not.toContain('c-secret');
      expect(body).not.toContain('r-token');
      const row = store.bookingsByKey.get('cal:mock:conv:conv-1');
      expect(row.status).toBe('failed');
      expect(row.last_error).not.toContain('c-secret');

      process.env.CALENDAR_ENABLED = 'false';
      const disabled = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send(slot(72));
      expect(disabled.status).toBe(503);
      expect(disabled.body.error.message).toContain('not configured');
    });

    it('emits meeting.scheduled through n8n infra without blocking the response', async () => {
      process.env.N8N_ENABLED = 'true';
      process.env.N8N_WEBHOOK_SECRET = 'top-secret-value';
      process.env.N8N_WORKFLOWS_JSON = JSON.stringify({
        'meeting.scheduled': [{ name: 'meet-pipe', url: 'https://n8n.example/webhook/m' }],
      });
      const store = makeStore();
      installMock(store);
      const s = slot(24);
      const res = await request(app)
        .post('/api/v1/conversations/conv-1/calendar/book')
        .set('Authorization', auth())
        .send(s);
      expect(res.status).toBe(201);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(n8n.calls).toHaveLength(1);
      const { envelope } = n8n.calls[0];
      expect(envelope.event).toBe('meeting.scheduled');
      expect(envelope.event_id).toBe('n8n:meeting.scheduled:conv-1');
      expect(envelope.data.source).toBe('conversation');
      expect(envelope.data.conversation).toMatchObject({ id: 'conv-1' });
      expect(envelope.data.meeting).toMatchObject({
        bookingId: res.body.data.id,
        provider: 'mock',
        meetUrl: res.body.data.meet_url,
      });
      expect(JSON.stringify(envelope)).not.toContain('top-secret-value');
    });

    it('keeps the legacy call booking path working with call anchors', async () => {
      const store = makeStore();
      store.callRow = { id: 'call-1', lead_id: 'lead-1' };
      store.callState = { id: 's1', call_id: 'call-1', lead_id: 'lead-1', pickup_location: 'Chennai' };
      installMock(store);
      const out = await requestCalendarBooking({ callId: 'call-1', ...slot(24) });
      expect(out.ok).toBe(true);
      expect(out.booking?.conversation_id).toBeNull();
      expect(out.booking?.booking_key).toBe('cal:mock:call-1');
    });
  });

  // ---------------------------------------------------------------
  // Text tools
  // ---------------------------------------------------------------
  describe('calendar text tools', () => {
    const ctx = { conversationId: 'conv-1', leadId: 'lead-1' };

    it('advertises only allowlisted calendar tools (no endCall/SQL/URL tools)', () => {
      expect(isTextToolName('checkCalendarAvailability')).toBe(true);
      expect(isTextToolName('scheduleMeeting')).toBe(true);
    });

    it('checks availability read-only without booking', async () => {
      const store = makeStore();
      installMock(store);
      const s = slot(24);
      const out = await executeCheckCalendarAvailabilityText(ctx, s);
      expect(out).toMatchObject({ success: true });
      expect(out.message).toContain('available');
      expect(calendar.bookingCalls).toHaveLength(0);
    });

    it('books only with explicit start/end and trusted identity', async () => {
      const store = makeStore();
      installMock(store);
      const s = slot(24);
      const out = await dispatchConversationTool(ctx, 'scheduleMeeting', {
        ...s,
        title: 'Intro call',
        leadId: 'lead-evil',
      });
      // LLM-supplied leadId is rejected as a forbidden key; trusted ctx wins.
      expect(out.success).toBe(false);
      expect(calendar.bookingCalls).toHaveLength(0);

      const ok = await executeScheduleMeetingText(ctx, { ...s, title: 'Intro call' });
      expect(ok.success).toBe(true);
      expect(ok.message).toContain('mock-');
      const row = store.bookingsByKey.get('cal:mock:conv:conv-1');
      expect(row.lead_id).toBe('lead-1');
    });

    it('never books from required_date alone or missing/invalid input', async () => {
      const store = makeStore();
      installMock(store);
      // required_date exists on state but is rejected as a tool argument.
      for (const args of [
        { required_date: '2026-12-25' },
        { start: futureIso(24) },
        { start: 'not-a-date', end: futureIso(25) },
        '{not json',
      ]) {
        const out = await executeScheduleMeetingText(ctx, args as any);
        expect(out.success).toBe(false);
      }
      expect(calendar.bookingCalls).toHaveLength(0);
      const check = await executeCheckCalendarAvailabilityText(ctx, { start: futureIso(24) });
      expect(check.success).toBe(false);
    });

    it('refuses booking when the conversation has no linked lead', async () => {
      installMock(makeStore());
      const out = await executeScheduleMeetingText(
        { conversationId: 'conv-1', leadId: null },
        slot(24)
      );
      expect(out.success).toBe(false);
      expect(calendar.bookingCalls).toHaveLength(0);
    });
  });
});
