import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { orchestrator, isKnowledgeSearchRequired, limitContextMessages } from '../agent/orchestrator';
import { MockLlmProvider } from '../agent/llm';
import {
  extractStateFromMessage,
  mergeTextConversationState,
  validateTextStateUpdate,
} from '../agent/textStateExtraction';
import { extractAndPersistTextState, getStateByCallId } from '../services/conversationStateService';
import * as knowledgeService from '../services/knowledgeService';
import { getChatMaxContextMessages } from '../config';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const TEST_SECRET = 'phase4-test-secret-do-not-use-in-prod';

// ---------------------------------------------------------------------------
// Helpers: in-memory fake backend for the text API flow.
// ---------------------------------------------------------------------------
const makeStore = () => ({
  convo: {
    id: 'conv-1',
    lead_id: 'lead-1',
    channel: 'web',
    status: 'active',
    started_at: new Date().toISOString(),
    ended_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as any,
  messages: [] as any[],
  msgSeq: 0,
  textState: null as any,
  leadRow: { id: 'lead-1', name: 'Test Lead', phone: '+911234567890', status: 'NEW' } as any,
});

type Store = ReturnType<typeof makeStore>;

const installTextMock = (store: Store) => {
  (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
    if (sql.includes('SELECT * FROM conversations WHERE id')) {
      return { rows: store.convo ? [store.convo] : [] };
    }
    if (sql.includes('UPDATE conversation_states SET')) {
      if (!store.textState) return { rows: [] };
      // Apply params in order; last param is conversationId.
      const cols = sql
        .split('SET')[1]
        .split('WHERE')[0]
        .split(',')
        .map((c) => c.trim().split(' ')[0])
        .filter((c) => c && c !== 'updated_at' && c !== 'updated_at=NOW()');
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
      return { rows: store.textState ? [store.textState] : [] };
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
      // Respect the recent-window LIMIT when present (getRecent passes it).
      const limit = typeof params[1] === 'number' ? params[1] : store.messages.length;
      const rows = [...store.messages].slice(-limit);
      return { rows };
    }
    if (sql.includes('FROM leads WHERE id')) {
      return { rows: store.leadRow ? [store.leadRow] : [] };
    }
    if (sql.includes('SELECT * FROM conversations')) {
      return { rows: store.convo ? [store.convo] : [] };
    }
    return { rows: [] };
  });
};

describe('Phase 4: Text Agent + RAG + Multi-turn Context', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of [
      'CHAT_JWT_SECRET',
      'CHAT_RATE_LIMIT_MAX',
      'CHAT_MESSAGE_RATE_LIMIT_MAX',
      'CHAT_MAX_MESSAGE_LENGTH',
      'CHAT_MAX_CONTEXT_MESSAGES',
      'LLM_PROVIDER',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.CHAT_JWT_SECRET = TEST_SECRET;
    process.env.CHAT_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MESSAGE_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MAX_MESSAGE_LENGTH = '4000';
    process.env.LLM_PROVIDER = 'mock';
    delete process.env.CHAT_MAX_CONTEXT_MESSAGES;
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
    delete process.env.CHAT_MAX_CONTEXT_MESSAGES;
  });

  const auth = (sub = 'tester') => `Bearer ${signChatToken(sub)}`;

  // ---------------------------------------------------------------
  // 1. Multi-turn message context
  // ---------------------------------------------------------------
  describe('multi-turn message context', () => {
    it('message 1 persists; message 2 receives message 1 as context in order', async () => {
      const store = makeStore();
      installTextMock(store);
      const spy = jest.spyOn(orchestrator, 'processTurn');
      try {
        const first = await request(app)
          .post('/api/v1/conversations/conv-1/messages')
          .set('Authorization', auth())
          .send({ content: 'My pickup is Chennai' });
        expect(first.status).toBe(201);
        expect(store.messages.map((m) => m.role)).toEqual(['user', 'assistant']);

        const second = await request(app)
          .post('/api/v1/conversations/conv-1/messages')
          .set('Authorization', auth())
          .send({ content: 'Destination is Bengaluru' });
        expect(second.status).toBe(201);

        // Second turn saw the full prior transcript (roles + order preserved).
        const secondCall = spy.mock.calls[1][0];
        const roles = secondCall.messages.map((m: any) => m.role);
        expect(roles).toEqual(['user', 'assistant', 'user']);
        expect(secondCall.messages[0].content).toContain('Chennai');
        expect(secondCall.messages[2].content).toContain('Bengaluru');
        // DB-only metadata never crosses into the LLM input.
        for (const m of secondCall.messages) {
          expect(Object.keys(m).sort()).toEqual(['content', 'role']);
        }
        // No duplicated system prompts from the caller side.
        expect(secondCall.messages.filter((m: any) => m.role === 'system')).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    });

    it('context limit bounds the LLM input but keeps all persisted rows', async () => {
      process.env.CHAT_MAX_CONTEXT_MESSAGES = '2';
      expect(getChatMaxContextMessages()).toBe(2);
      const store = makeStore();
      installTextMock(store);
      const spy = jest.spyOn(orchestrator, 'processTurn');
      try {
        await request(app).post('/api/v1/conversations/conv-1/messages').set('Authorization', auth()).send({ content: 'Turn one here' });
        await request(app).post('/api/v1/conversations/conv-1/messages').set('Authorization', auth()).send({ content: 'Turn two here' });
        await request(app).post('/api/v1/conversations/conv-1/messages').set('Authorization', auth()).send({ content: 'Turn three here' });

        // 3 turns persisted 6 rows; last turn forwarded only the window.
        expect(store.messages.length).toBe(6);
        const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
        expect(lastCall.messages.length).toBeLessThanOrEqual(2);
        expect(lastCall.messages[lastCall.messages.length - 1].content).toContain('Turn three');
      } finally {
        spy.mockRestore();
        delete process.env.CHAT_MAX_CONTEXT_MESSAGES;
      }
    });

    it('limitContextMessages slices chronologically and defaults to config', () => {
      expect(limitContextMessages([1, 2, 3, 4, 5], 2)).toEqual([4, 5]);
      expect(limitContextMessages([1, 2], 10)).toEqual([1, 2]);
      delete process.env.CHAT_MAX_CONTEXT_MESSAGES;
      expect(getChatMaxContextMessages()).toBe(30);
    });
  });

  // ---------------------------------------------------------------
  // 2 + 3. State extraction + deterministic merge
  // ---------------------------------------------------------------
  describe('state extraction and merge', () => {
    it('creates state from text on the first turn', async () => {
      const store = makeStore();
      installTextMock(store);
      const res = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'Hi, I need a truck from Chennai to Bengaluru, 500kg' });
      expect(res.status).toBe(201);
      expect(store.textState).toBeTruthy();
      expect(store.textState.pickup_location).toBe('Chennai');
      expect(store.textState.destination).toBe('Bengaluru');
      expect(Number(store.textState.cargo_weight)).toBe(500);
    });

    it('updates across turns, corrects a field, and preserves unrelated fields', async () => {
      const store = makeStore();
      installTextMock(store);
      await request(app).post('/api/v1/conversations/conv-1/messages').set('Authorization', auth()).send({ content: 'Pickup is Chennai, destination Bengaluru' });
      expect(store.textState.pickup_location).toBe('Chennai');
      expect(store.textState.destination).toBe('Bengaluru');

      await request(app).post('/api/v1/conversations/conv-1/messages').set('Authorization', auth()).send({ content: 'Actually pickup should be Tambaram.' });
      expect(store.textState.pickup_location).toBe('Tambaram');
      expect(store.textState.destination).toBe('Bengaluru');
    });

    it('merge leaves existing fields unchanged on unknown/null updates', () => {
      const existing = { pickup_location: 'Chennai', destination: 'Bengaluru', budget: 15000 };
      expect(mergeTextConversationState(existing as any, {})).toMatchObject(existing);
      expect(
        mergeTextConversationState(existing as any, {
          pickup_location: 'unknown',
          destination: '',
          budget: null as any,
        })
      ).toMatchObject(existing);
      expect(
        mergeTextConversationState(existing as any, { pickup_location: 'Tambaram' })
      ).toMatchObject({ pickup_location: 'Tambaram', destination: 'Bengaluru', budget: 15000 });
    });

    it('rejects invalid values safely (validation, no SQL)', () => {
      const bad = validateTextStateUpdate({
        cargo_weight: 'not-a-number',
        budget: -5,
        booking_intent: 'someday',
        pickup_location: '; DROP TABLE conversations; --',
        ' Pickup; DELETE FROM leads;': 'x',
        customer_name: 'Arun',
      });
      expect(bad.sanitized).toEqual({ customer_name: 'Arun' });
      expect(bad.errors.length).toBeGreaterThan(0);

      // Unknown tokens never overwrite.
      const merged = mergeTextConversationState(
        { pickup_location: 'Chennai' } as any,
        validateTextStateUpdate({ pickup_location: 'unknown' }).sanitized
      );
      expect(merged.pickup_location).toBe('Chennai');

      // Non-object / array payloads are rejected, never executed.
      expect(validateTextStateUpdate(null).valid).toBe(false);
      expect(validateTextStateUpdate([]).valid).toBe(false);
      expect(validateTextStateUpdate('SELECT * FROM leads').valid).toBe(false);
    });

    it('extractAndPersistTextState never throws and ignores empty input', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
      await expect(extractAndPersistTextState('', 'hello')).resolves.toMatchObject({ stateChanged: false });
      await expect(extractAndPersistTextState('conv-1', '   ')).resolves.toMatchObject({ stateChanged: false });
      await expect(extractAndPersistTextState('conv-1', 'Hi')).resolves.toMatchObject({ stateChanged: false });
    });
  });

  // ---------------------------------------------------------------
  // 4. RAG behavior
  // ---------------------------------------------------------------
  describe('selective RAG', () => {
    it('retrieves for knowledge questions, not for trivial messages', () => {
      expect(isKnowledgeSearchRequired('What vehicles do you provide?')).toBe(true);
      expect(isKnowledgeSearchRequired('Do you operate on Sundays?')).toBe(true);
      expect(isKnowledgeSearchRequired('What are your cargo restrictions?')).toBe(true);
      expect(isKnowledgeSearchRequired('What is your delivery policy?')).toBe(true);
      expect(isKnowledgeSearchRequired('Hi')).toBe(false);
      expect(isKnowledgeSearchRequired('Okay')).toBe(false);
      expect(isKnowledgeSearchRequired('Thanks')).toBe(false);
      expect(isKnowledgeSearchRequired('Hello, good morning')).toBe(false);
      expect(isKnowledgeSearchRequired('My pickup location is Chennai')).toBe(false);
    });

    it('retrieved context reaches the LLM system prompt', async () => {
      (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
        if (sql.includes('FROM conversation_states')) return { rows: [] };
        return { rows: [] };
      });
      const searchSpy = jest
        .spyOn(knowledgeService, 'searchKnowledge')
        .mockResolvedValue({
          query: 'What vehicles do you provide?',
          totalResults: 1,
          results: [{ title: 'Fleet Guide', chunkText: 'We operate 14ft containers and trucks.' } as any],
        });
      const provider = new MockLlmProvider();
      const seen: any[] = [];
      const genSpy = jest.spyOn(provider, 'generateResponse').mockImplementation(async (messages: any[]) => {
        seen.push(messages);
        return { content: 'ok', finishReason: 'stop' };
      });
      const { getLlmProvider } = await import('../agent/llm');
      const llmModule = await import('../agent/llm');
      const providerSpy = jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(provider);
      try {
        const res = await orchestrator.processTurn({
          conversationId: 'conv-rag',
          messages: [{ role: 'user', content: 'What vehicles do you provide?' }],
        });
        expect(res.content).toBe('ok');
        expect(searchSpy).toHaveBeenCalled();
        const system = seen[0].find((m: any) => m.role === 'system').content;
        expect(system).toContain('RETRIEVED KNOWLEDGE');
        expect(system).toContain('Fleet Guide');
      } finally {
        searchSpy.mockRestore();
        genSpy.mockRestore();
        providerSpy.mockRestore();
      }
      void getLlmProvider;
    });

    it('trivial messages skip retrieval entirely', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
      const searchSpy = jest.spyOn(knowledgeService, 'searchKnowledge');
      try {
        await orchestrator.processTurn({
          conversationId: 'conv-trivial',
          messages: [{ role: 'user', content: 'Thanks' }],
        });
        expect(searchSpy).not.toHaveBeenCalled();
      } finally {
        searchSpy.mockRestore();
      }
    });
  });

  // ---------------------------------------------------------------
  // 5. Safety
  // ---------------------------------------------------------------
  describe('LLM response safety', () => {
    it('LLM failure keeps the user message and persists no assistant message', async () => {
      const store = makeStore();
      installTextMock(store);
      const failing = new MockLlmProvider();
      jest.spyOn(failing, 'generateResponse').mockRejectedValue(new Error('LLM exploded'));
      const llmModule = await import('../agent/llm');
      const providerSpy = jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(failing);
      try {
        const res = await request(app)
          .post('/api/v1/conversations/conv-1/messages')
          .set('Authorization', auth())
          .send({ content: 'Hello, need a truck' });
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        // User turn retained; no fake assistant success recorded.
        expect(store.messages.filter((m) => m.role === 'user')).toHaveLength(1);
        expect(store.messages.filter((m) => m.role === 'assistant')).toHaveLength(0);
        expect(JSON.stringify(res.body)).not.toContain('systemPrompt');
        expect(JSON.stringify(res.body)).not.toContain('OPERATOR CONFIGURATION');
      } finally {
        providerSpy.mockRestore();
      }
    });

    it('extracted state can never execute SQL or touch the filesystem', () => {
      const update = validateTextStateUpdate({
        pickup_location: "Chennai'; DROP TABLE conversations; --",
        customer_name: 'Arun Kumar',
        additional_requirements: 'x"; require("fs").unlinkSync("/tmp/x"); //',
      }).sanitized;
      // Dangerous payloads are dropped; only safe columns could persist.
      expect(update.pickup_location).toBeUndefined();
      expect(update.additional_requirements).toBeUndefined();
      expect(update.customer_name).toBe('Arun Kumar');
    });
  });

  // ---------------------------------------------------------------
  // 6. Compatibility: callId path + legacy state lookup untouched
  // ---------------------------------------------------------------
  describe('voice/call compatibility', () => {
    it('existing callId orchestrator path still resolves legacy state', async () => {
      const mockState = {
        id: 'state-123',
        call_id: 'call-123',
        customer_name: 'John Doe',
        pickup_location: 'Chennai',
        destination: 'Bengaluru',
        cargo_weight: 500,
      };
      (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
        if (sql.includes('FROM conversation_state WHERE call_id')) return { rows: [mockState] };
        if (sql.includes('FROM conversation_states')) return { rows: [] };
        return { rows: [] };
      });
      const response = await orchestrator.processTurn({
        callId: 'call-123',
        messages: [{ role: 'user', content: 'Where is my pickup?' }],
      });
      expect(response.content).toBeDefined();
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM conversation_state WHERE call_id = $1',
        ['call-123']
      );
    });

    it('old conversation_state lookup still hits the legacy table', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 's1', call_id: 'call-1' }] });
      const state = await getStateByCallId('call-1');
      expect(state).toEqual({ id: 's1', call_id: 'call-1' });
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM conversation_state WHERE call_id = $1',
        ['call-1']
      );
    });
  });
});
