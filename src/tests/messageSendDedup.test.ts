/**
 * Message-send integration: idempotent POSTs and deterministic memory answers.
 *
 * Proves, with the network boundary at supertest and a mocked pool:
 * - same Idempotency-Key twice → one user + one assistant row (replay);
 * - new keys → new rows (identical texts never merged);
 * - "What is my name?" → the exact stored fact, with no LLM turn.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { resetIdempotencyForTests } from '../services/messageIdempotency';
import { LlmProvider } from '../agent/llm';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const TEST_SECRET = 'idempotency-test-secret-do-not-use-in-prod';

const convo = {
  id: 'conv-idem',
  lead_id: null,
  user_id: null,
  channel: 'web',
  status: 'active',
  started_at: new Date().toISOString(),
  ended_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as any;

const memState = {
  id: 'st-idem',
  conversation_id: 'conv-idem',
  customer_name: 'Santhosh',
  pickup_location: 'Chennai',
  destination: 'Bangalore',
  vehicle_type: '32ft truck',
  cargo_weight: 500,
  budget: 30000,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as any;

describe('message idempotency + memory answers (integration)', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let msgSeq = 0;

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
    resetChatRateLimitsForTests();
    resetIdempotencyForTests();
    msgSeq = 0;
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM conversations WHERE')) return { rows: [convo] };
      if (sql.includes('INSERT INTO conversation_messages')) {
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
      if (sql.includes('COUNT(*) AS total FROM conversation_messages')) return { rows: [{ total: '0' }] };
      if (sql.includes('UPDATE conversation_states SET')) return { rows: [memState] };
      if (sql.includes('INSERT INTO conversation_states')) return { rows: [memState] };
      if (sql.includes('FROM conversation_states')) return { rows: [memState] };
      return { rows: [] };
    });
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const scripted: LlmProvider = {
      getProviderName: () => 'scripted-idempotency',
      generateResponse: async () => ({ content: 'Noted.', finishReason: 'stop' }),
    } as any;
    jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(scripted);
  });

  const auth = () => `Bearer ${signChatToken('tester', 3600, TEST_SECRET)}`;

  const postMessage = (content: string, key?: string) => {
    const req = request(app)
      .post('/api/v1/conversations/conv-idem/messages')
      .set('Authorization', auth())
      .send({ content });
    return key ? req.set('Idempotency-Key', key) : req;
  };

  it('persists exactly one user + one assistant row for a double POST with the same key', async () => {
    const first = await postMessage('I need a truck', 'key-abc-123');
    expect(first.status).toBe(201);
    const second = await postMessage('I need a truck', 'key-abc-123');
    expect(second.status).toBe(201);
    expect(second.body.data.userMessage.id).toBe(first.body.data.userMessage.id);
    expect(second.body.data.assistantMessage.id).toBe(first.body.data.assistantMessage.id);
    expect(messageInserts()).toHaveLength(2);
  });

  it('persists new rows for a new key even with identical content', async () => {
    await postMessage('I need a truck', 'key-one');
    const other = await postMessage('I need a truck', 'key-two');
    expect(other.status).toBe(201);
    expect(messageInserts()).toHaveLength(4);
  });

  it('answers a memory question with the exact stored fact and no LLM turn', async () => {
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const providerSpy = jest.spyOn(llmModule, 'getLlmProvider');
    providerSpy.mockClear();

    const res = await postMessage('What is my name?', 'key-mem-1');
    expect(res.status).toBe(201);
    expect(res.body.data.assistantMessage.content).toBe('Your name is Santhosh.');
    expect(providerSpy).not.toHaveBeenCalled();
    expect(messageInserts()).toHaveLength(2);
  });

  it('answers a multi-question paste in one assistant message', async () => {
    const res = await postMessage(
      'What is my name?\nWhat is my pickup?\nWhat is my destination?',
      'key-mem-3'
    );
    expect(res.status).toBe(201);
    expect(res.body.data.assistantMessage.content).toBe(
      'Your name is Santhosh.\nYour pickup location is Chennai.\nYour destination is Bangalore.'
    );
    expect(messageInserts()).toHaveLength(2);
  });
});
