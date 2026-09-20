/**
 * Tamil message-send integration (supertest boundary, mocked pool).
 *
 * Proves over HTTP, with no real LLM or database:
 * - a Tamil message persists byte-exact and gets exactly one assistant reply;
 * - a Tamil memory question is answered from state with no LLM turn;
 * - an LLM failure keeps the user message, persists no assistant, and 500s
 *   (safe error state — the turn never hangs);
 * - a repeated Tamil POST under one Idempotency-Key never duplicates rows.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { resetIdempotencyForTests } from '../services/messageIdempotency';
import { LlmProvider, LlmRequestError } from '../agent/llm';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const TEST_SECRET = 'tamil-conversation-test-secret-do-not-use-in-prod';

const convo = {
  id: 'conv-tamil',
  lead_id: null,
  user_id: null,
  channel: 'web',
  status: 'active',
  started_at: new Date().toISOString(),
  ended_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as any;

const tamilState = {
  id: 'st-tamil',
  conversation_id: 'conv-tamil',
  customer_name: 'சந்தோஷ்',
  pickup_location: 'சென்னை',
  destination: 'பெங்களூரு',
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
} as any;

describe('Tamil message-send integration', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let msgSeq = 0;
  let insertedParams: any[][] = [];

  const messageInserts = () =>
    (pool.query as jest.Mock).mock.calls.filter(([sql]: string[]) =>
      sql.includes('INSERT INTO conversation_messages')
    );

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
    resetIdempotencyForTests();
    msgSeq = 0;
    insertedParams = [];
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM conversations WHERE')) return { rows: [convo] };
      if (sql.includes('INSERT INTO conversation_messages')) {
        insertedParams.push(params);
        const row = {
          id: `msg-${++msgSeq}`,
          conversation_id: params[0],
          role: params[1],
          content: params[2],
          metadata: params[3],
          tool_calls: params[4],
          created_at: new Date().toISOString(),
        };
        return { rows: [row] };
      }
      if (sql.includes('FROM conversation_messages')) return { rows: [] };
      if (sql.includes('UPDATE conversation_states SET')) return { rows: [tamilState] };
      if (sql.includes('INSERT INTO conversation_states')) return { rows: [tamilState] };
      if (sql.includes('FROM conversation_states')) return { rows: [tamilState] };
      return { rows: [] };
    });
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const scripted: LlmProvider = {
      getProviderName: () => 'scripted-tamil',
      generateResponse: async () => ({
        content: 'வணக்கம்! உங்கள் shipment-க்கு உதவுகிறேன்.',
        finishReason: 'stop',
      }),
    } as any;
    jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(scripted);
  });

  const auth = () => `Bearer ${signChatToken('tester', 3600, TEST_SECRET)}`;

  const postMessage = (content: string, key?: string) => {
    const req = request(app)
      .post('/api/v1/conversations/conv-tamil/messages')
      .set('Authorization', auth())
      .send({ content });
    return key ? req.set('Idempotency-Key', key) : req;
  };

  it('persists Tamil exactly and replies once (1 user + 1 assistant)', async () => {
    const res = await postMessage('வணக்கம்', 'key-ta-basic');
    expect(res.status).toBe(201);
    expect(res.body.data.userMessage.content).toBe('வணக்கம்');
    expect(Array.from(res.body.data.userMessage.content)).toEqual(Array.from('வணக்கம்'));
    expect(typeof res.body.data.assistantMessage.content).toBe('string');
    expect(res.body.data.assistantMessage.content.length).toBeGreaterThan(0);
    expect(messageInserts()).toHaveLength(2);
    // The user row reached the repository byte-exact (no sanitization loss).
    expect(insertedParams[0][2]).toBe('வணக்கம்');
  });

  it('answers a Tamil memory question from state with no LLM turn', async () => {
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const providerSpy = jest.spyOn(llmModule, 'getLlmProvider');
    providerSpy.mockClear();

    const res = await postMessage('என்னுடைய பெயர் என்ன?', 'key-ta-mem');
    expect(res.status).toBe(201);
    expect(res.body.data.assistantMessage.content).toBe('உங்கள் பெயர் சந்தோஷ்.');
    expect(providerSpy).not.toHaveBeenCalled();
    expect(messageInserts()).toHaveLength(2);
  });

  it('answers a Tamil pickup question from state with no LLM turn', async () => {
    const res = await postMessage('என்னுடைய pickup location என்ன?', 'key-ta-pickup');
    expect(res.status).toBe(201);
    expect(res.body.data.assistantMessage.content).toBe('உங்கள் pickup: சென்னை.');
    expect(messageInserts()).toHaveLength(2);
  });

  it('routes a Tamil correction to the LLM turn (never a memory shortcut)', async () => {
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const providerSpy = jest.spyOn(llmModule, 'getLlmProvider');
    providerSpy.mockClear();

    // "Change my pickup to Tambaram" — must NOT be answered from memory.
    const res = await postMessage('என்னுடைய pickup-ஐ Tambaram ஆக மாற்றுங்கள்.', 'key-ta-fix');
    expect(res.status).toBe(201);
    expect(providerSpy).toHaveBeenCalled();
    expect(messageInserts()).toHaveLength(2);
  });

  it('keeps the user message and persists no assistant when the LLM fails', async () => {
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    jest
      .spyOn(llmModule, 'getLlmProvider')
      .mockReturnValue({
        getProviderName: () => 'failing',
        generateResponse: async () => {
          throw new LlmRequestError('Ollama request failed.');
        },
      } as any);

    // A Tamil statement (not a memory question) forces a real LLM turn.
    const res = await postMessage('எனக்கு சென்னையிலிருந்து பெங்களூருக்கு பொருட்களை அனுப்ப வேண்டும்.', 'key-ta-fail');
    expect(res.status).toBe(500);
    // Exactly the user row persisted; no assistant row, no hang.
    expect(messageInserts()).toHaveLength(1);
    expect(insertedParams[0][1]).toBe('user');
    expect(insertedParams[0][2]).toBe(
      'எனக்கு சென்னையிலிருந்து பெங்களூருக்கு பொருட்களை அனுப்ப வேண்டும்.'
    );
  });

  it('never duplicates a Tamil turn retried under one Idempotency-Key', async () => {
    const first = await postMessage('500 கிலோ எலக்ட்ரானிக்ஸ் பொருட்கள்.', 'key-ta-dupe');
    expect(first.status).toBe(201);
    const second = await postMessage('500 கிலோ எலக்ட்ரானிக்ஸ் பொருட்கள்.', 'key-ta-dupe');
    expect(second.status).toBe(201);
    expect(second.body.data.userMessage.id).toBe(first.body.data.userMessage.id);
    expect(second.body.data.assistantMessage.id).toBe(first.body.data.assistantMessage.id);
    expect(messageInserts()).toHaveLength(2);
  });
});
