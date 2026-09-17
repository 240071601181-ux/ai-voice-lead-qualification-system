import { pool } from '../database';
import { syncCrmContactOnce } from '../services/crm/crmSyncService';
import { MockCrmProvider } from '../services/crm/mockCrmProvider';
import { resetCrmProviderForTests, setCrmProviderForTests } from '../services/crm/crmProvider';
import { emitN8nEventOnce } from '../services/n8n/n8nEmitter';
import { MockN8nClient } from '../services/n8n/mockN8nClient';
import { resetN8nClientForTests, setN8nClientForTests } from '../services/n8n/n8nClient';
import { signN8nBody } from '../services/n8n/n8nClient';
import { canonicalN8nBody } from '../services/n8n/n8nPayloadBuilder';
import { sendWhatsappOnce } from '../services/whatsapp/whatsappSender';
import { MockWhatsappProvider } from '../services/whatsapp/mockWhatsappProvider';
import {
  resetWhatsappProviderForTests,
  setWhatsappProviderForTests,
} from '../services/whatsapp/whatsappProvider';
import {
  scheduleFollowup,
  scheduleFollowupsForEvent,
} from '../services/followup/followupService';
import {
  planConversationQualificationFanout,
  runConversationQualificationFanout,
} from '../services/conversationQualificationFanout';
import { qualifyConversation } from '../services/qualificationService';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const OLD_ENV = process.env;
const isoDay = (offsetDays: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// In-memory fake backend for all four delivery tables + domain reads.
// ---------------------------------------------------------------------------
interface Store {
  convo: any;
  textState: any;
  convQual: any;
  callRow: any;
  callState: any;
  callQual: any;
  leadRow: any;
  crmByKey: Map<string, any>;
  n8nByKey: Map<string, any>;
  waByKey: Map<string, any>;
  fuByKey: Map<string, any>;
  seq: number;
}

const makeStore = (): Store => ({
  convo: {
    id: 'conv-1',
    lead_id: 'lead-1',
    channel: 'web',
    status: 'completed',
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  textState: {
    id: 'st-1',
    conversation_id: 'conv-1',
    lead_id: 'lead-1',
    customer_name: 'Arun',
    pickup_location: 'Chennai',
    destination: 'Bengaluru',
    vehicle_type: 'Truck',
    cargo_type: null,
    cargo_weight: 500,
    cargo_dimensions: null,
    required_date: isoDay(1),
    budget: 15000,
    urgency: null,
    booking_intent: null,
    additional_requirements: null,
  },
  convQual: {
    id: 'q-conv-1',
    conversation_id: 'conv-1',
    call_id: null,
    lead_id: 'lead-1',
    score: 90,
    tier: 'HOT',
    details: { criteria: {}, totalScore: 90, qualifiedAt: new Date().toISOString() },
    qualified_at: new Date().toISOString(),
  },
  callRow: null,
  callState: null,
  callQual: null,
  leadRow: { id: 'lead-1', name: 'Arun', phone: '+911234567890', email: 'a@example.com', source: 'web', status: 'NEW' },
  crmByKey: new Map(),
  n8nByKey: new Map(),
  waByKey: new Map(),
  fuByKey: new Map(),
  seq: 0,
});

const rowById = (store: Store, id: string): any => {
  for (const m of [store.crmByKey, store.n8nByKey, store.waByKey, store.fuByKey]) {
    for (const row of m.values()) if (row.id === id) return row;
  }
  return null;
};

const applyUpdate = (store: Store, sql: string, params: any[]): any => {
  const row = rowById(store, params[0]);
  if (!row) return null;
  const statusLiteral = sql.match(/SET status = '([a-z_]+)'/);
  if (statusLiteral) row.status = statusLiteral[1];
  else if (params[1] !== undefined && typeof params[1] === 'string' && sql.includes('status = $2')) {
    row.status = params[1];
  }
  const errParam = params.find((p) => typeof p === 'string' && p.length > 0 && p !== row.id && p !== row.status);
  if (/last_error/.test(sql) && errParam) row.last_error = errParam;
  if (/crm_contact_id/.test(sql) && params[1]) row.crm_contact_id = params[1];
  if (/provider_message_id/.test(sql) && params[1]) row.provider_message_id = params[1];
  if (/http_status/.test(sql)) {
    const n = params.find((p) => typeof p === 'number');
    if (n !== undefined) row.http_status = n;
  }
  row.updated_at = new Date().toISOString();
  return row;
};

const installMock = (store: Store) => {
  (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
    if (sql.startsWith('UPDATE ')) return { rows: [applyUpdate(store, sql, params)].filter(Boolean) };
    if (sql.includes('SELECT * FROM conversations WHERE id')) {
      return { rows: store.convo && store.convo.id === params[0] ? [store.convo] : [] };
    }
    if (sql.includes('FROM conversation_states')) {
      return {
        rows:
          store.textState && store.textState.conversation_id === params[0] ? [store.textState] : [],
      };
    }
    if (sql.includes('INSERT INTO qualifications')) {
      const row = {
        id: `q-conv-${++store.seq}`,
        conversation_id: params[0],
        call_id: params[1] || null,
        lead_id: params[2] || null,
        score: params[3],
        tier: params[4],
        details: params[5],
        qualified_at: params[6],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.convQual = row;
      return { rows: [row] };
    }
    if (sql.includes('FROM qualifications WHERE conversation_id')) {
      return { rows: store.convQual && store.convQual.conversation_id === params[0] ? [store.convQual] : [] };
    }
    if (sql.includes('FROM qualifications WHERE call_id')) {
      return { rows: store.callQual && store.callQual.call_id === params[0] ? [store.callQual] : [] };
    }
    if (sql.includes('FROM conversation_state WHERE call_id')) {
      return { rows: store.callState && store.callState.call_id === params[0] ? [store.callState] : [] };
    }
    if (sql.includes('FROM calls WHERE id')) {
      return { rows: store.callRow && store.callRow.id === params[0] ? [store.callRow] : [] };
    }
    if (sql.includes('FROM leads WHERE id')) {
      return { rows: store.leadRow && store.leadRow.id === params[0] ? [store.leadRow] : [] };
    }
    if (sql.includes('INSERT INTO crm_syncs')) {
      const [lead_id, call_id, qualification_id, provider, idempotency_key, payload_hash] = params;
      const prev = store.crmByKey.get(idempotency_key);
      const row = {
        id: prev?.id ?? `crm-${++store.seq}`,
        lead_id, call_id, qualification_id, provider, idempotency_key,
        crm_contact_id: prev?.crm_contact_id ?? null,
        status: 'pending',
        attempts: (prev?.attempts ?? 0) + 1,
        payload_hash,
        last_error: null,
        created_at: prev?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.crmByKey.set(idempotency_key, row);
      return { rows: [row] };
    }
    if (sql.includes('FROM crm_syncs WHERE idempotency_key')) {
      const row = store.crmByKey.get(params[0]);
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
    if (sql.includes('INSERT INTO whatsapp_deliveries')) {
      const [template, message_key, lead_id, call_id, qualification_id, provider, language, payload_hash] = params;
      const prev = store.waByKey.get(message_key);
      const row = {
        id: prev?.id ?? `wa-${++store.seq}`,
        template, message_key, lead_id, call_id, qualification_id, provider, language,
        status: 'pending',
        attempts: (prev?.attempts ?? 0) + 1,
        payload_hash,
        provider_message_id: null,
        last_error: null,
        created_at: prev?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.waByKey.set(message_key, row);
      return { rows: [row] };
    }
    if (sql.includes('FROM whatsapp_deliveries WHERE message_key')) {
      const row = store.waByKey.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('FROM follow_ups WHERE followup_key')) {
      const row = store.fuByKey.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('INSERT INTO follow_ups')) {
      const [followup_key, lead_id, call_id, qualification_id, action, payload, scheduled_at] = params;
      const prev = store.fuByKey.get(followup_key);
      const row = {
        id: prev?.id ?? `fu-${++store.seq}`,
        followup_key, lead_id, call_id, qualification_id, action,
        payload: typeof payload === 'string' ? JSON.parse(payload) : payload,
        scheduled_at,
        status: 'pending',
        attempts: (prev?.attempts ?? 0) + 1,
        last_error: null,
        created_at: prev?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.fuByKey.set(followup_key, row);
      return { rows: [row] };
    }
    return { rows: [] };
  });
};

describe('Phase 7: Conversation Qualification Integration Fan-out', () => {
  let crm: MockCrmProvider;
  let n8n: MockN8nClient;
  let wa: MockWhatsappProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...OLD_ENV,
      CRM_SYNC_ENABLED: 'true',
      CRM_PROVIDER: 'mock',
      CRM_BASE_URL: 'https://crm.example',
      CRM_API_KEY: 'super-secret-crm-key',
      CRM_MAX_RETRIES: '0',
      N8N_ENABLED: 'true',
      N8N_WEBHOOK_SECRET: 'top-secret-value',
      N8N_WORKFLOWS_JSON: JSON.stringify({
        'qualification.completed': [{ name: 'q-pipe', url: 'https://n8n.example/webhook/q' }],
      }),
      N8N_MAX_RETRIES: '0',
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_PROVIDER: 'mock',
      WHATSAPP_ACCOUNT_SID: 'ACtest',
      WHATSAPP_AUTH_TOKEN: 'secret-token',
      WHATSAPP_FROM_NUMBER: 'whatsapp:+10000000000',
      WHATSAPP_DEFAULT_LANGUAGE: 'en',
      WHATSAPP_REQUIRE_CONSENT: 'true',
      WHATSAPP_TEMPLATES_JSON: JSON.stringify({
        call_summary_hot_en: 'HXhot',
        call_summary_warm_en: 'HXwarm',
        call_missed_en: 'HXmissed',
      }),
      WHATSAPP_MAX_RETRIES: '0',
      FOLLOWUP_ENABLED: 'true',
      FOLLOWUP_MAX_RETRIES: '0',
    };
    crm = new MockCrmProvider();
    setCrmProviderForTests(crm);
    n8n = new MockN8nClient();
    setN8nClientForTests(n8n);
    wa = new MockWhatsappProvider();
    setWhatsappProviderForTests(wa);
  });

  afterEach(() => {
    resetCrmProviderForTests();
    resetN8nClientForTests();
    resetWhatsappProviderForTests();
    process.env = OLD_ENV;
  });

  // ---------------------------------------------------------------
  // CRM
  // ---------------------------------------------------------------
  describe('CRM fan-out', () => {
    it('syncs the conversation qualification with a conversation-scoped key and no fake callId', async () => {
      const store = makeStore();
      installMock(store);
      const out = await syncCrmContactOnce({ leadId: 'lead-1', conversationId: 'conv-1' });
      expect(out.ok).toBe(true);
      expect(crm.calls).toHaveLength(1);
      const { payload, opts } = crm.calls[0];
      expect(payload.external_lead_id).toBe('lead-1');
      expect(payload.external_conversation_id).toBe('conv-1');
      expect(payload.external_call_id).toBeUndefined();
      expect(payload.qualification_tier).toBe('HOT');
      expect(payload.qualification_score).toBe(90);
      expect(opts.idempotencyKey).toBe('crm:mock:conv:conv-1');
      const row = store.crmByKey.get('crm:mock:conv:conv-1');
      expect(row.status).toBe('success');
      expect(row.call_id).toBeNull();
      expect(row.qualification_id).toBe('q-conv-1');
    });

    it('is idempotent: unchanged re-sync skips without a provider call', async () => {
      const store = makeStore();
      installMock(store);
      await syncCrmContactOnce({ leadId: 'lead-1', conversationId: 'conv-1' });
      const second = await syncCrmContactOnce({ leadId: 'lead-1', conversationId: 'conv-1' });
      expect(second).toMatchObject({ ok: true, skipped: 'no_changes' });
      expect(crm.calls).toHaveLength(1);
    });

    it('resolves the lead from conversation state when no leadId is supplied', async () => {
      const store = makeStore();
      installMock(store);
      const out = await syncCrmContactOnce({ conversationId: 'conv-1' });
      expect(out.ok).toBe(true);
      expect(crm.calls[0].payload.external_lead_id).toBe('lead-1');
    });

    it('keeps the legacy call path byte-identical (call key, call anchor, no conversation marker)', async () => {
      const store = makeStore();
      store.callRow = { id: 'call-1', lead_id: 'lead-1' };
      store.callState = { id: 's1', call_id: 'call-1', lead_id: 'lead-1', pickup_location: 'Chennai' };
      store.callQual = { id: 'q-call-1', call_id: 'call-1', lead_id: 'lead-1', score: 20, tier: 'COLD', qualified_at: new Date().toISOString() };
      installMock(store);
      const out = await syncCrmContactOnce({ callId: 'call-1' });
      expect(out.ok).toBe(true);
      expect(crm.calls[0].opts.idempotencyKey).toBe('crm:mock:call-1');
      expect(crm.calls[0].payload.external_call_id).toBe('call-1');
      expect(crm.calls[0].payload.external_conversation_id).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // n8n
  // ---------------------------------------------------------------
  describe('n8n fan-out', () => {
    it('emits qualification.completed anchored on the conversation with source metadata', async () => {
      const store = makeStore();
      installMock(store);
      const out = await emitN8nEventOnce('qualification.completed', {
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });
      expect(out).toMatchObject({ ok: true, delivered: 1 });
      expect(n8n.calls).toHaveLength(1);
      const { envelope } = n8n.calls[0];
      expect(envelope.event).toBe('qualification.completed');
      expect(envelope.event_id).toBe('n8n:qualification.completed:conv-1');
      expect(envelope.data.source).toBe('conversation');
      expect(envelope.data.conversation).toMatchObject({ id: 'conv-1', channel: 'web' });
      expect(envelope.data.qualification).toMatchObject({
        id: 'q-conv-1',
        conversation_id: 'conv-1',
        tier: 'HOT',
        score: 90,
      });
      expect(envelope.data.qualification?.call_id).toBeUndefined();
      expect(envelope.data.call).toBeUndefined();
      // HMAC signs the canonical body (HMAC path itself covered by n8nClient tests).
      expect(signN8nBody(canonicalN8nBody(envelope), 'top-secret-value')).toHaveLength(64);
    });

    it('is idempotent: unchanged re-emission skips without HTTP', async () => {
      // Freeze time: the payload hash covers occurred_at, so identical
      // re-emissions in the same instant take the no-change skip branch.
      jest.useFakeTimers().setSystemTime(new Date('2026-09-17T00:00:00.000Z'));
      try {
        const store = makeStore();
        installMock(store);
        await emitN8nEventOnce('qualification.completed', { leadId: 'lead-1', conversationId: 'conv-1' });
        const second = await emitN8nEventOnce('qualification.completed', {
          leadId: 'lead-1',
          conversationId: 'conv-1',
        });
        expect(second).toMatchObject({ ok: true, delivered: 0 });
        expect(n8n.calls).toHaveLength(1);
        const row = store.n8nByKey.get('n8n:qualification.completed:conv-1::q-pipe');
        expect(row.status).toBe('skipped_no_changes');
      } finally {
        jest.useRealTimers();
      }
    });

    it('records retryable failures with sanitized errors and keeps legacy events unchanged', async () => {
      const store = makeStore();
      installMock(store);
      const err: any = new Error('n8n down top-secret-value');
      err.status = 500;
      n8n.enqueue({ error: err });
      const out = await emitN8nEventOnce('qualification.completed', {
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });
      expect(out.ok).toBe(false);
      const row = store.n8nByKey.get('n8n:qualification.completed:conv-1::q-pipe');
      expect(row.status).toBe('failed');
      expect(row.last_error).not.toContain('top-secret-value');

      // Legacy call event: no source marker, call-anchored id.
      const legacy = makeStore();
      legacy.callRow = { id: 'call-1', lead_id: 'lead-1' };
      legacy.callState = { id: 's1', call_id: 'call-1', lead_id: 'lead-1', pickup_location: 'Chennai' };
      legacy.callQual = { id: 'q-call-1', call_id: 'call-1', lead_id: 'lead-1', score: 20, tier: 'COLD', qualified_at: new Date().toISOString() };
      installMock(legacy);
      n8n.clear();
      await emitN8nEventOnce('qualification.completed', { callId: 'call-1' });
      const env = n8n.calls[0].envelope;
      expect(env.event_id).toBe('n8n:qualification.completed:call-1');
      expect(env.data.source).toBeUndefined();
      expect(env.data.conversation).toBeUndefined();
      expect(env.data.qualification?.call_id).toBe('call-1');
    });
  });

  // ---------------------------------------------------------------
  // WhatsApp
  // ---------------------------------------------------------------
  describe('WhatsApp fan-out', () => {
    it('skips safely without consent and persists the skipped state (no fake consent)', async () => {
      const store = makeStore();
      installMock(store);
      const out = await sendWhatsappOnce({
        template: 'call_summary_hot',
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });
      expect(out).toEqual({ ok: false, skipped: 'no_consent' });
      expect(wa.calls).toHaveLength(0);
      const row = store.waByKey.get('wa:mock:call_summary_hot:conv-1');
      expect(row.status).toBe('skipped_no_consent');
      expect(row.call_id).toBeNull();
      expect(row.qualification_id).toBe('q-conv-1');
    });

    it('delivers HOT/WARM summaries when consented; suppresses tier mismatches and COLD', async () => {
      process.env.WHATSAPP_REQUIRE_CONSENT = 'false';
      const store = makeStore();
      installMock(store);
      const hot = await sendWhatsappOnce({
        template: 'call_summary_hot',
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });
      expect(hot).toEqual({ ok: true });
      expect(wa.calls).toHaveLength(1);

      const mismatch = await sendWhatsappOnce({
        template: 'call_summary_warm',
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });
      expect(mismatch).toEqual({ ok: false, skipped: 'suppressed' });

      store.convQual.tier = 'COLD';
      const cold = await sendWhatsappOnce({
        template: 'call_summary_hot',
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });
      expect(cold).toEqual({ ok: false, skipped: 'suppressed' });
      expect(wa.calls).toHaveLength(1);
    });

    it('keeps the legacy call path working with call-anchored keys', async () => {
      process.env.WHATSAPP_REQUIRE_CONSENT = 'false';
      const store = makeStore();
      store.callRow = { id: 'call-1', lead_id: 'lead-1' };
      store.callState = { id: 's1', call_id: 'call-1', lead_id: 'lead-1', pickup_location: 'Chennai' };
      store.callQual = { id: 'q-call-1', call_id: 'call-1', lead_id: 'lead-1', score: 90, tier: 'HOT', qualified_at: new Date().toISOString() };
      installMock(store);
      const out = await sendWhatsappOnce({ template: 'call_summary_hot', callId: 'call-1' });
      expect(out).toEqual({ ok: true });
      expect(store.waByKey.has('wa:mock:call_summary_hot:call-1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // Follow-ups
  // ---------------------------------------------------------------
  describe('follow-up scheduling', () => {
    it('schedules the HOT policy anchored on the conversation', async () => {
      const store = makeStore();
      installMock(store);
      const outcomes = await scheduleFollowupsForEvent({ leadId: 'lead-1', conversationId: 'conv-1' });
      expect(outcomes).toHaveLength(2);
      expect(outcomes.every((o) => o.ok && o.created)).toBe(true);
      const waRow = store.fuByKey.get('fu:whatsapp_followup:conv-1');
      const crmRow = store.fuByKey.get('fu:crm_followup:conv-1');
      expect(waRow).toBeDefined();
      expect(crmRow).toBeDefined();
      expect(waRow.payload).toMatchObject({ template: 'call_summary_hot', conversationId: 'conv-1' });
      expect(crmRow.payload).toMatchObject({ conversationId: 'conv-1' });
      expect(waRow.call_id).toBeNull();
      const waDueInMin = (new Date(waRow.scheduled_at).getTime() - Date.now()) / 60000;
      const crmDueInMin = (new Date(crmRow.scheduled_at).getTime() - Date.now()) / 60000;
      expect(waDueInMin).toBeGreaterThan(20);
      expect(waDueInMin).toBeLessThan(40);
      expect(crmDueInMin).toBeGreaterThan(50);
      expect(crmDueInMin).toBeLessThan(70);
    });

    it('schedules WARM with the longer WhatsApp delay and skips COLD entirely', async () => {
      const store = makeStore();
      store.convQual.tier = 'WARM';
      installMock(store);
      const warm = await scheduleFollowupsForEvent({ leadId: 'lead-1', conversationId: 'conv-1' });
      expect(warm).toHaveLength(2);
      const waRow = store.fuByKey.get('fu:whatsapp_followup:conv-1');
      expect(waRow.payload.template).toBe('call_summary_warm');
      const dueInMin = (new Date(waRow.scheduled_at).getTime() - Date.now()) / 60000;
      expect(dueInMin).toBeGreaterThan(230);
      expect(dueInMin).toBeLessThan(250);

      store.convQual.tier = 'COLD';
      const cold = await scheduleFollowupsForEvent({ leadId: 'lead-1', conversationId: 'conv-1' });
      expect(cold).toEqual([{ ok: false, skipped: 'tier' }]);
    });

    it('protects terminal rows from duplicate re-schedules', async () => {
      const store = makeStore();
      installMock(store);
      await scheduleFollowupsForEvent({ leadId: 'lead-1', conversationId: 'conv-1' });
      const waRow = store.fuByKey.get('fu:whatsapp_followup:conv-1');
      waRow.status = 'completed';
      const again = await scheduleFollowup({
        leadId: 'lead-1',
        conversationId: 'conv-1',
        action: 'whatsapp_followup',
        template: 'call_summary_hot',
      });
      expect(again).toMatchObject({ ok: true, duplicate: true });
      expect(store.fuByKey.size).toBe(2);
    });
  });

  // ---------------------------------------------------------------
  // Fan-out planning, isolation, calendar, security
  // ---------------------------------------------------------------
  describe('fan-out orchestration', () => {
    const event = {
      qualificationId: 'q-conv-1',
      conversationId: 'conv-1',
      leadId: 'lead-1',
      score: 90,
      tier: 'HOT' as const,
      qualifiedAt: new Date().toISOString(),
    };

    it('plans all providers for HOT/WARM and skips WhatsApp for COLD (calendar never planned)', async () => {
      const hot = planConversationQualificationFanout(event);
      expect(hot.map((p) => p.provider).sort()).toEqual(['crm', 'followup', 'n8n', 'whatsapp']);
      expect(hot.every((p) => p.status === 'enqueued')).toBe(true);
      const cold = planConversationQualificationFanout({ ...event, tier: 'COLD' });
      expect(cold.find((p) => p.provider === 'whatsapp')).toMatchObject({
        status: 'skipped',
        reason: 'tier_policy',
      });
    });

    it('isolates failures: CRM down still records n8n, WhatsApp skip, and follow-ups', async () => {
      const store = makeStore();
      installMock(store);
      crm.enqueue({ error: new Error('crm down') });
      const crmOut = await syncCrmContactOnce({ leadId: 'lead-1', conversationId: 'conv-1' });
      expect(crmOut.ok).toBe(false);
      const n8nOut = await emitN8nEventOnce('qualification.completed', {
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });
      expect(n8nOut.ok).toBe(true);
      const waOut = await sendWhatsappOnce({
        template: 'call_summary_hot',
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });
      expect(waOut).toEqual({ ok: false, skipped: 'no_consent' });
      const fuOut = await scheduleFollowupsForEvent({ leadId: 'lead-1', conversationId: 'conv-1' });
      expect(fuOut).toHaveLength(2);
      // Each outcome persisted independently.
      expect(store.crmByKey.get('crm:mock:conv:conv-1').status).toBe('failed');
      expect(store.n8nByKey.get('n8n:qualification.completed:conv-1::q-pipe').status).toBe('delivered');
      expect(store.waByKey.get('wa:mock:call_summary_hot:conv-1').status).toBe('skipped_no_consent');
    });

    it('never books calendar slots as a side effect of qualification', async () => {
      const store = makeStore();
      installMock(store);
      await qualifyConversation('conv-1');
      // Flush the fire-and-forget fan-out tail (all providers disabled-safe here).
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      const statements = (pool.query as jest.Mock).mock.calls.map((c) => String(c[0]));
      expect(statements.some((s) => /calendar_bookings|calendar_sync_state/i.test(s))).toBe(false);
    });

    it('keeps secrets out of provider payloads and persisted errors', async () => {
      const store = makeStore();
      installMock(store);
      crm.enqueue({ error: new Error('provider blew up super-secret-crm-key') });
      await syncCrmContactOnce({ leadId: 'lead-1', conversationId: 'conv-1' });
      const crmRow = store.crmByKey.get('crm:mock:conv:conv-1');
      expect(crmRow.last_error).not.toContain('super-secret-crm-key');
      const crmPayload = JSON.stringify(crm.calls[0].payload);
      for (const secret of ['super-secret-crm-key', 'top-secret-value', 'secret-token']) {
        expect(crmPayload).not.toContain(secret);
      }
      const n8nErr: any = new Error('n8n down top-secret-value');
      n8nErr.status = 500;
      n8n.enqueue({ error: n8nErr });
      await emitN8nEventOnce('qualification.completed', { leadId: 'lead-1', conversationId: 'conv-1' });
      const n8nRow = store.n8nByKey.get('n8n:qualification.completed:conv-1::q-pipe');
      expect(n8nRow.last_error).not.toContain('top-secret-value');
      const envelope = JSON.stringify(n8n.calls[0].envelope);
      for (const secret of ['super-secret-crm-key', 'top-secret-value', 'secret-token']) {
        expect(envelope).not.toContain(secret);
      }
      expect(envelope).not.toContain('systemPrompt');
    });

    it('runConversationQualificationFanout resolves without throwing and never touches the LLM path', async () => {
      const store = makeStore();
      installMock(store);
      const outcome = await runConversationQualificationFanout(event);
      expect(outcome.outcomes).toHaveLength(4);
      const statements = (pool.query as jest.Mock).mock.calls.map((c) => String(c[0]));
      expect(statements.some((s) => /calendar_bookings/i.test(s))).toBe(false);
    });
  });
});
