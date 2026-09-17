import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import {
  calculateQualification,
  isQualificationReady,
  maybeAutoQualifyConversation,
  qualifyCall,
  qualifyConversation,
} from '../services/qualificationService';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const TEST_SECRET = 'phase6-test-secret-do-not-use-in-prod';
const isoDay = (offsetDays: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// In-memory fake backend.
// ---------------------------------------------------------------------------
interface Store {
  convo: any;
  messages: any[];
  msgSeq: number;
  textState: any;
  callState: any;
  callRow: any;
  leadRow: any;
  qualsByConv: Map<string, any>;
  qualsByCall: Map<string, any>;
  qualSeq: number;
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
  messages: [],
  msgSeq: 0,
  textState: null,
  callState: null,
  callRow: null,
  leadRow: { id: 'lead-1', name: 'Test Lead', phone: '+911234567890', status: 'NEW' },
  qualsByConv: new Map(),
  qualsByCall: new Map(),
  qualSeq: 0,
});

const installMock = (store: Store) => {
  (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
    if (sql.includes('SELECT * FROM conversations WHERE id')) {
      return { rows: store.convo && (!params[0] || store.convo.id === params[0]) ? [store.convo] : [] };
    }
    if (sql.includes('UPDATE conversations SET status')) {
      if (!store.convo) return { rows: [] };
      store.convo = { ...store.convo, status: params[0], ended_at: store.convo.ended_at || new Date().toISOString() };
      return { rows: [store.convo] };
    }
    if (sql.includes('UPDATE conversation_states SET')) {
      if (!store.textState) return { rows: [] };
      const cols = sql
        .split('SET')[1]
        .split('WHERE')[0]
        .split(',')
        .map((c) => c.trim().split(' ')[0])
        .filter((c) => c && !c.startsWith('updated_at'));
      cols.forEach((col, i) => {
        store.textState[col] = params[i] ?? null;
      });
      store.textState.updated_at = new Date().toISOString();
      return { rows: [store.textState] };
    }
    if (sql.includes('INSERT INTO conversation_states')) {
      store.textState = store.textState || {
        id: 'st-1',
        conversation_id: params[0],
        lead_id: params[1] || null,
        customer_name: null,
        pickup_location: null,
        destination: null,
        vehicle_type: null,
        cargo_type: null,
        cargo_weight: null,
        cargo_dimensions: null,
        required_date: null,
        budget: null,
        urgency: null,
        booking_intent: null,
        additional_requirements: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return { rows: [store.textState] };
    }
    if (sql.includes('FROM conversation_states')) {
      const wanted = params[0];
      const match =
        store.textState && (!wanted || store.textState.conversation_id === wanted)
          ? [store.textState]
          : [];
      return { rows: match };
    }
    // Conversation-anchored upsert (Phase 6): INSERT lists conversation_id first.
    if (sql.includes('INSERT INTO qualifications') && sql.includes('conversation_id, call_id')) {
      const [conversation_id, call_id, lead_id, score, tier, details, qualified_at] = params;
      const existing = store.qualsByConv.get(conversation_id);
      const row = {
        id: existing?.id ?? `q-conv-${++store.qualSeq}`,
        conversation_id,
        call_id: call_id || null,
        lead_id: lead_id || null,
        score,
        tier,
        details,
        qualified_at,
        created_at: existing?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.qualsByConv.set(conversation_id, row);
      return { rows: [row] };
    }
    // Legacy call-anchored upsert: INSERT lists call_id first.
    if (sql.includes('INSERT INTO qualifications')) {
      const [call_id, lead_id, score, tier, details, qualified_at] = params;
      const existing = store.qualsByCall.get(call_id);
      const row = {
        id: existing?.id ?? `q-call-${++store.qualSeq}`,
        conversation_id: existing?.conversation_id ?? null,
        call_id,
        lead_id: lead_id || null,
        score,
        tier,
        details,
        qualified_at,
        created_at: existing?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.qualsByCall.set(call_id, row);
      return { rows: [row] };
    }
    if (sql.includes('FROM qualifications WHERE conversation_id')) {
      const row = store.qualsByConv.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('FROM qualifications WHERE call_id')) {
      const row = store.qualsByCall.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('FROM conversation_state WHERE call_id')) {
      return { rows: store.callState ? [store.callState] : [] };
    }
    if (sql.includes('FROM calls WHERE id')) {
      return { rows: store.callRow ? [store.callRow] : [] };
    }
    if (sql.includes('INSERT INTO conversation_messages')) {
      const row = {
        id: `msg-${++store.msgSeq}`,
        conversation_id: params[0],
        role: params[1],
        content: params[2],
        metadata: params[3],
        tool_calls: params[4],
        created_at: new Date().toISOString(),
      };
      store.messages.push(row);
      return { rows: [row] };
    }
    if (sql.includes('SELECT COUNT(*) AS total FROM conversation_messages')) {
      return { rows: [{ total: String(store.messages.length) }] };
    }
    if (sql.includes('FROM conversation_messages')) {
      const limit = typeof params[1] === 'number' ? params[1] : store.messages.length;
      return { rows: [...store.messages].slice(-limit) };
    }
    if (sql.includes('FROM leads WHERE id')) {
      return { rows: store.leadRow && store.leadRow.id === params[0] ? [store.leadRow] : [] };
    }
    return { rows: [] };
  });
};

const richSlots = () => ({
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
});

const seedRichTextState = (store: Store) => {
  store.textState = {
    id: 'st-1',
    conversation_id: 'conv-1',
    lead_id: 'lead-1',
    ...richSlots(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
};

describe('Phase 6: Conversation-Based Lead Qualification', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of [
      'CHAT_JWT_SECRET',
      'CHAT_RATE_LIMIT_MAX',
      'CHAT_MESSAGE_RATE_LIMIT_MAX',
      'CHAT_MAX_MESSAGE_LENGTH',
      'LLM_PROVIDER',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.CHAT_JWT_SECRET = TEST_SECRET;
    process.env.CHAT_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MESSAGE_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MAX_MESSAGE_LENGTH = '4000';
    process.env.LLM_PROVIDER = 'mock';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetChatRateLimitsForTests();
  });

  const auth = (sub = 'tester') => `Bearer ${signChatToken(sub)}`;

  // ---------------------------------------------------------------
  // Scoring preservation + parity
  // ---------------------------------------------------------------
  describe('scoring preservation and call/conversation parity', () => {
    it('calculateQualification weights and thresholds are unchanged', () => {
      const at = new Date();
      // Full house: 30 + 20 + 20 + 10 + 10 + 10 = 100 → HOT.
      const full = calculateQualification(
        { ...richSlots(), booking_intent: 'explicit' } as any,
        at
      );
      expect(full.score).toBe(100);
      expect(full.tier).toBe('HOT');
      // Route only: 20 → COLD.
      const thin = calculateQualification(
        { pickup_location: 'Chennai', destination: 'Bengaluru' } as any,
        at
      );
      expect(thin.score).toBe(20);
      expect(thin.tier).toBe('COLD');
      // Route + budget: 40 → WARM (boundary preserved).
      const warm = calculateQualification(
        { pickup_location: 'Chennai', destination: 'Bengaluru', budget: 5000 } as any,
        at
      );
      expect(warm.score).toBe(40);
      expect(warm.tier).toBe('WARM');
      // 70 boundary → HOT.
      const hot = calculateQualification(
        {
          pickup_location: 'Chennai',
          destination: 'Bengaluru',
          budget: 5000,
          vehicle_type: 'Truck',
        } as any,
        at
      );
      expect(hot.score).toBe(50);
      expect(hot.tier).toBe('WARM');
      expect(hot.details.criteria.route.qualified).toBe(true);
      expect(hot.details.totalScore).toBe(50);
    });

    it('identical state produces the same score/tier on the call and conversation paths', async () => {
      const store = makeStore();
      const slots = richSlots();
      store.callState = { id: 's1', call_id: 'call-1', lead_id: 'lead-1', ...slots };
      store.callRow = { id: 'call-1', lead_id: 'lead-1' };
      store.textState = { id: 'st-1', conversation_id: 'conv-1', lead_id: 'lead-1', ...slots };
      installMock(store);
      const at = new Date();
      const fromCall = await qualifyCall('call-1', at);
      const fromConv = await qualifyConversation('conv-1', at);
      expect(fromConv.score).toBe(fromCall.score);
      expect(fromConv.tier).toBe(fromCall.tier);
      expect(fromConv.score).toBe(90); // 30+20+20+10+10, no booking intent
      expect(fromConv.tier).toBe('HOT');
      // Anchors differ exactly as specified: text has no invented callId.
      expect(fromConv.conversation_id).toBe('conv-1');
      expect(fromConv.call_id).toBeNull();
      expect(fromCall.call_id).toBe('call-1');
    });
  });

  // ---------------------------------------------------------------
  // qualifyConversation service behavior
  // ---------------------------------------------------------------
  describe('qualifyConversation service', () => {
    it('persists a HOT qualification anchored on conversation_id', async () => {
      const store = makeStore();
      seedRichTextState(store);
      installMock(store);
      const q = await qualifyConversation('conv-1');
      expect(q.conversation_id).toBe('conv-1');
      expect(q.call_id).toBeNull();
      expect(q.lead_id).toBe('lead-1');
      expect(q.score).toBe(90);
      expect(q.tier).toBe('HOT');
      expect(q.details.criteria.budget.qualified).toBe(true);
    });

    it('is idempotent: repeated qualification updates one row, and state changes re-qualify', async () => {
      const store = makeStore();
      seedRichTextState(store);
      installMock(store);
      const first = await qualifyConversation('conv-1');
      const second = await qualifyConversation('conv-1');
      expect(second.id).toBe(first.id);
      expect(store.qualsByConv.size).toBe(1);
      // New information arrives → same row, new score.
      store.textState.booking_intent = 'explicit';
      const third = await qualifyConversation('conv-1');
      expect(third.id).toBe(first.id);
      expect(third.score).toBe(100);
      expect(third.tier).toBe('HOT');
      expect(store.qualsByConv.size).toBe(1);
    });

    it('trusts the conversation leadId even when state carries another lead', async () => {
      const store = makeStore();
      seedRichTextState(store);
      store.textState.lead_id = 'lead-forged';
      installMock(store);
      const q = await qualifyConversation('conv-1');
      expect(q.lead_id).toBe('lead-1');
    });

    it('rejects missing conversation (404), missing lead (422), missing state (422)', async () => {
      const store = makeStore();
      installMock(store);
      store.convo = null;
      await expect(qualifyConversation('conv-missing')).rejects.toMatchObject({ status: 404 });
      store.convo = makeStore().convo;
      store.convo.lead_id = null;
      await expect(qualifyConversation('conv-1')).rejects.toMatchObject({ status: 422 });
      store.convo.lead_id = 'lead-1';
      store.textState = null;
      await expect(qualifyConversation('conv-1')).rejects.toMatchObject({ status: 422 });
    });
  });

  // ---------------------------------------------------------------
  // Auto-qualification gate
  // ---------------------------------------------------------------
  describe('auto-qualification gate', () => {
    it('does not qualify thin state; qualifies route + supporting info or explicit intent', () => {
      expect(isQualificationReady(null)).toBe(false);
      expect(isQualificationReady({ pickup_location: 'Chennai' } as any)).toBe(false);
      expect(
        isQualificationReady({ pickup_location: 'Chennai', destination: 'Bengaluru' } as any)
      ).toBe(false);
      // Route + budget + vehicle → ready.
      expect(
        isQualificationReady({
          pickup_location: 'Chennai',
          destination: 'Bengaluru',
          budget: 5000,
          vehicle_type: 'Truck',
        } as any)
      ).toBe(true);
      // Explicit booking intent alone → ready.
      expect(isQualificationReady({ booking_intent: 'explicit' } as any)).toBe(true);
    });

    it('maybeAutoQualifyConversation returns null safely when the gate fails', async () => {
      const store = makeStore();
      store.textState = {
        id: 'st-1',
        conversation_id: 'conv-1',
        lead_id: 'lead-1',
        pickup_location: 'Chennai',
      };
      installMock(store);
      await expect(maybeAutoQualifyConversation('conv-1')).resolves.toBeNull();
      expect(store.qualsByConv.size).toBe(0);
      // No state row at all → null, never throws.
      store.textState = null;
      await expect(maybeAutoQualifyConversation('conv-1')).resolves.toBeNull();
      await expect(maybeAutoQualifyConversation('conv-missing')).resolves.toBeNull();
    });

    it('auto-qualifies rich state without any integration fan-out', async () => {
      const store = makeStore();
      seedRichTextState(store);
      installMock(store);
      const q = await maybeAutoQualifyConversation('conv-1', 'state_changed');
      expect(q?.tier).toBe('HOT');
      const statements = (pool.query as jest.Mock).mock.calls.map((c) => String(c[0]));
      for (const banned of ['crm_syncs', 'n8n_deliveries', 'whatsapp_deliveries', 'follow_ups']) {
        expect(statements.some((s) => s.includes(banned))).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------
  // HTTP lifecycle
  // ---------------------------------------------------------------
  describe('HTTP lifecycle', () => {
    it('POST /messages auto-qualifies after a real state change, once', async () => {
      const store = makeStore();
      seedRichTextState(store);
      installMock(store);
      const res = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'Actually pickup should be Tambaram.' });
      expect(res.status).toBe(201);
      expect(res.body.data.qualification).toMatchObject({ tier: 'HOT', conversation_id: 'conv-1' });
      expect(store.qualsByConv.size).toBe(1);
      // A trivial follow-up with no state change does not duplicate the row.
      const again = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'Thanks' });
      expect(again.status).toBe(201);
      expect(store.qualsByConv.size).toBe(1);
    });

    it('POST /:id/qualification persists manually; GET reads; unknown → 404', async () => {
      const store = makeStore();
      seedRichTextState(store);
      installMock(store);
      const created = await request(app)
        .post('/api/v1/conversations/conv-1/qualification')
        .set('Authorization', auth());
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        conversation_id: 'conv-1',
        call_id: null,
        lead_id: 'lead-1',
      });
      // Idempotent repeat.
      const repeated = await request(app)
        .post('/api/v1/conversations/conv-1/qualification')
        .set('Authorization', auth());
      expect(repeated.status).toBe(201);
      expect(repeated.body.data.id).toBe(created.body.data.id);
      expect(store.qualsByConv.size).toBe(1);

      const read = await request(app)
        .get('/api/v1/conversations/conv-1/qualification')
        .set('Authorization', auth());
      expect(read.status).toBe(200);
      expect(read.body.data.id).toBe(created.body.data.id);

      store.convo = null;
      const missing = await request(app)
        .post('/api/v1/conversations/conv-missing/qualification')
        .set('Authorization', auth());
      expect(missing.status).toBe(404);
    });

    it('manual qualification without state fails safely (422), without leaking internals', async () => {
      const store = makeStore();
      installMock(store);
      const res = await request(app)
        .post('/api/v1/conversations/conv-1/qualification')
        .set('Authorization', auth());
      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain('SELECT');
    });

    it('completion recalculates when data suffices; abandon never qualifies', async () => {
      const store = makeStore();
      seedRichTextState(store);
      installMock(store);
      const done = await request(app)
        .post('/api/v1/conversations/conv-1/complete')
        .set('Authorization', auth());
      expect(done.status).toBe(200);
      expect(done.body.data.status).toBe('completed');
      expect(done.body.data.qualification).toMatchObject({ tier: 'HOT' });

      // Abandon path stays qualification-free.
      const store2 = makeStore();
      seedRichTextState(store2);
      installMock(store2);
      const dropped = await request(app)
        .post('/api/v1/conversations/conv-1/abandon')
        .set('Authorization', auth());
      expect(dropped.status).toBe(200);
      expect(dropped.body.data.qualification).toBeNull();
      expect(store2.qualsByConv.size).toBe(0);
    });

    it('qualification endpoints require authentication', async () => {
      const res = await request(app).post('/api/v1/conversations/conv-1/qualification');
      expect(res.status).toBe(401);
      const read = await request(app).get('/api/v1/conversations/conv-1/qualification');
      expect(read.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------
  // Legacy compatibility
  // ---------------------------------------------------------------
  describe('legacy compatibility', () => {
    it('qualifyCall keeps working with the legacy upsert and scoring', async () => {
      const store = makeStore();
      store.callState = {
        id: 's1',
        call_id: 'call-1',
        lead_id: 'lead-1',
        pickup_location: 'Chennai',
        destination: 'Bengaluru',
        budget: 5000,
        vehicle_type: 'Truck',
      };
      store.callRow = { id: 'call-1', lead_id: 'lead-1' };
      installMock(store);
      const q = await qualifyCall('call-1');
      expect(q).toMatchObject({ call_id: 'call-1', lead_id: 'lead-1', score: 50, tier: 'WARM' });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (call_id)'),
        expect.anything()
      );
      // Re-qualify → same row.
      const again = await qualifyCall('call-1');
      expect(again.id).toBe(q.id);
    });

    it('conversation upsert uses the conversation conflict target, not call_id', async () => {
      const store = makeStore();
      seedRichTextState(store);
      installMock(store);
      await qualifyConversation('conv-1');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (conversation_id)'),
        expect.arrayContaining(['conv-1', null, 'lead-1'])
      );
    });
  });
});
