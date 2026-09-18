/**
 * Final-response fallback: when the LLM produces no usable final text
 * (empty, tool-call JSON, or "working on it" placeholder), the controller
 * composes a deterministic reply grounded ONLY in persisted state.
 *
 * Proves:
 * - placeholder phrasing is detected (and never served)
 * - tool-call JSON is rejected as final content
 * - normal/model text (incl. error explanations) is preserved
 * - the fallback confirms only recorded facts, never invents
 * - the next question targets the first missing qualification field
 * - end-to-end: tool turn with empty final content persists the
 *   informative summary (no placeholder, no JSON)
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { LlmProvider } from '../agent/llm';
import {
  buildInformativeFallback,
  isPlaceholderLike,
  isUnusableFinalContent,
} from '../agent/fallbackResponse';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const TEST_SECRET = 'fallback-test-secret-do-not-use-in-prod';

describe('placeholder + unusable-content detection', () => {
  it('flags internal placeholder phrasing', () => {
    for (const text of [
      'Working on your request — one moment.',
      'Working on your request - one moment.',
      'Working on it, please wait.',
      'Processing...',
      'Processing your request.',
      'Executing tool updateConversationState.',
      'Calling function now.',
    ]) {
      expect(isPlaceholderLike(text)).toBe(true);
    }
  });

  it('preserves genuine model text', () => {
    expect(isPlaceholderLike('Got it — 500 kg from Chennai to Bengaluru is noted.')).toBe(false);
    expect(isPlaceholderLike('I ran into a problem finishing that update. Please try again.')).toBe(false);
    expect(isPlaceholderLike('')).toBe(false);
    // Long messages are real content even with an unfortunate phrase.
    expect(isPlaceholderLike(`Intro. ${'x'.repeat(400)} one moment`)).toBe(false);
    // The informative fallback itself is never placeholder-like.
    expect(
      isPlaceholderLike(
        buildInformativeFallback({ pickup_location: 'Chennai' }, { updatedThisTurn: true })
      )
    ).toBe(false);
  });

  it('rejects empty/JSON/placeholder final content, keeps the rest', () => {
    expect(isUnusableFinalContent('')).toBe(true);
    expect(isUnusableFinalContent('   ')).toBe(true);
    expect(
      isUnusableFinalContent('{"name":"updateConversationState","parameters":{"updates":{}}}')
    ).toBe(true);
    expect(
      isUnusableFinalContent('{"name":"updateConversationState","parameters":{"updates":{')
    ).toBe(true);
    expect(isUnusableFinalContent('Working on your request — one moment.')).toBe(true);
    expect(isUnusableFinalContent('Pickup noted as Chennai. Where to?')).toBe(false);
    expect(isUnusableFinalContent('{"delivery":"tomorrow"}')).toBe(false);
  });
});

describe('informative fallback composer (state-grounded only)', () => {
  it('confirms recorded facts and asks the next missing field', () => {
    const text = buildInformativeFallback(
      { pickup_location: 'Chennai', destination: 'Bengaluru', cargo_weight: 500 },
      { updatedThisTurn: true }
    );
    expect(text).toContain('pickup Chennai');
    expect(text).toContain('destination Bengaluru');
    expect(text).toContain('cargo weight 500 kg');
    expect(text).toContain('What type of vehicle');
    expect(text).not.toContain('{');
    expect(text).not.toContain('parameters');
  });

  it('never invents unrecorded facts', () => {
    const text = buildInformativeFallback(
      { pickup_location: 'Chennai' },
      { updatedThisTurn: true }
    );
    expect(text).toContain('pickup Chennai');
    expect(text).not.toContain('Bengaluru');
    expect(text).not.toContain('INR');
    expect(text).not.toContain('500');
    expect(text).toContain('delivered');
  });

  it('uses on-file wording when this turn stored nothing new', () => {
    const text = buildInformativeFallback(
      { pickup_location: 'Chennai', destination: 'Bengaluru' },
      { updatedThisTurn: false }
    );
    expect(text).toContain('on file');
    expect(text).not.toContain("I've recorded");
  });

  it('greets and starts qualification when nothing is recorded', () => {
    for (const state of [null, undefined, {}]) {
      const text = buildInformativeFallback(state as any, { updatedThisTurn: false });
      expect(text).toContain('pickup location');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('null');
    }
  });

  it('asks the final question when everything is known', () => {
    const text = buildInformativeFallback(
      {
        customer_name: 'Ravi',
        pickup_location: 'Chennai',
        destination: 'Bengaluru',
        vehicle_type: 'Truck',
        cargo_type: 'general',
        cargo_weight: 500,
        required_date: '2026-10-01',
        budget: 25000,
        urgency: 'normal',
      },
      { updatedThisTurn: true }
    );
    expect(text).toContain('budget INR 25000');
    expect(text).toContain('anything else');
  });
});

describe('controller fallback end-to-end (tool executed, model silent)', () => {
  const savedEnv: Record<string, string | undefined> = {};

  const store = () => ({
    convo: {
      id: 'conv-fb',
      lead_id: null,
      user_id: null,
      channel: 'web',
      status: 'active',
      started_at: new Date().toISOString(),
      ended_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any,
    messages: [] as any[],
    msgSeq: 0,
    textState: {
      id: 'st-fb',
      conversation_id: 'conv-fb',
      pickup_location: 'Chennai',
      destination: 'Bengaluru',
      cargo_weight: 500,
      vehicle_type: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any,
  });

  type Store = ReturnType<typeof store>;

  const installMock = (s: Store) => {
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('SELECT * FROM conversations WHERE id = $1 AND user_id IS NULL')) {
        return { rows: [s.convo] };
      }
      if (sql.includes('SELECT * FROM conversations WHERE id')) {
        return { rows: [s.convo] };
      }
      if (sql.includes('INSERT INTO conversation_messages')) {
        const row = {
          id: `msg-${++s.msgSeq}`,
          conversation_id: params[0],
          role: params[1],
          content: params[2],
          metadata: params[3],
          tool_calls: params[4],
          created_at: new Date().toISOString(),
        };
        s.messages.push(row);
        return { rows: [row] };
      }
      if (sql.includes('FROM conversation_messages')) {
        return { rows: [...s.messages] };
      }
      if (sql.includes('SELECT COUNT(*) AS total FROM conversation_messages')) {
        return { rows: [{ total: String(s.messages.length) }] };
      }
      if (sql.includes('UPDATE conversation_states SET')) {
        return { rows: [s.textState] };
      }
      if (sql.includes('INSERT INTO conversation_states')) {
        return { rows: [s.textState] };
      }
      if (sql.includes('FROM conversation_states')) {
        return { rows: [s.textState] };
      }
      return { rows: [] };
    });
  };

  const scriptedProvider = (responses: Array<{ content: string }>): LlmProvider => {
    let i = 0;
    return {
      getProviderName: () => 'scripted-fallback-e2e',
      generateResponse: async () => {
        const next = responses[Math.min(i, responses.length - 1)];
        i += 1;
        return JSON.parse(JSON.stringify({ ...next, finishReason: 'stop' }));
      },
    };
  };

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
    jest.restoreAllMocks();
    resetChatRateLimitsForTests();
  });

  it('persists the informative summary when the model returns no usable text', async () => {
    const s = store();
    installMock(s);
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    // Tool executes, continuation stays silent → controller must compose
    // the state-grounded reply (never the placeholder, never JSON).
    jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(
      scriptedProvider([
        {
          content:
            '{"name":"updateConversationState","parameters":{"updates":{"pickup_location":"Chennai"}}}',
        },
        { content: '' },
      ])
    );

    const res = await request(app)
      .post('/api/v1/conversations/conv-fb/messages')
      .set('Authorization', `Bearer ${signChatToken('tester', 3600, TEST_SECRET)}`)
      .send({ content: 'Pickup is Chennai' });

    expect(res.status).toBe(201);
    const assistant = res.body.data.assistantMessage;
    expect(assistant.content).toContain('pickup Chennai');
    expect(assistant.content).toContain('destination Bengaluru');
    expect(assistant.content).toContain('What type of vehicle');
    expect(assistant.content).not.toContain('Working on your request');
    expect(assistant.content).not.toContain('"parameters"');
    const metadata =
      typeof assistant.metadata === 'string' ? JSON.parse(assistant.metadata) : assistant.metadata;
    expect(metadata).toEqual({
      toolsExecuted: [{ name: 'updateConversationState', success: true }],
    });
    // Persisted transcript matches the served response.
    const stored = s.messages.filter((m: any) => m.role === 'assistant').pop();
    expect(stored.content).toBe(assistant.content);
  });

  it('serves genuine model text untouched (no fallback override)', async () => {
    const s = store();
    installMock(s);
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(
      scriptedProvider([{ content: 'Noted Chennai. Where to?' }])
    );

    const res = await request(app)
      .post('/api/v1/conversations/conv-fb/messages')
      .set('Authorization', `Bearer ${signChatToken('tester', 3600, TEST_SECRET)}`)
      .send({ content: 'Pickup is Chennai' });

    expect(res.status).toBe(201);
    expect(res.body.data.assistantMessage.content).toBe('Noted Chennai. Where to?');
  });
});
