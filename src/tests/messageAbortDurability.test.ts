/**
 * Navigation durability, server side: once POST /messages is accepted, AI
 * processing (state extraction, LLM, RAG, tools, persistence) completes even
 * when the client disconnects mid-processing (SPA navigation, refresh, tab
 * close). No frontend promise, timer, or connection is required after the
 * request reaches the server. A same-key retry afterwards replays the
 * persisted rows instead of duplicating them.
 */
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { resetIdempotencyForTests } from '../services/messageIdempotency';
import { LlmProvider, LlmResponse } from '../agent/llm';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const TEST_SECRET = 'abort-durability-test-secret-do-not-use-in-prod';

const convo = {
  id: 'conv-abort',
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
  id: 'st-abort',
  conversation_id: 'conv-abort',
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
} as any;

describe('server-side durability across client disconnect', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let msgSeq = 0;
  let releaseLlm!: (response: LlmResponse) => void;
  let server: http.Server | null = null;
  let baseUrl = '';

  const messageInserts = () =>
    (pool.query as jest.Mock).mock.calls.filter(([sql]: string[]) =>
      sql.includes('INSERT INTO conversation_messages')
    );
  const stateWrites = () =>
    (pool.query as jest.Mock).mock.calls.filter(([sql]: string[]) =>
      sql.includes('INSERT INTO conversation_states') ||
      sql.includes('UPDATE conversation_states SET')
    );

  const waitFor = async (cond: () => boolean, label: string, timeoutMs = 8000) => {
    const start = Date.now();
    for (;;) {
      if (cond()) return;
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
      await new Promise((r) => setTimeout(r, 25));
    }
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

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
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
      if (sql.includes('UPDATE conversation_states SET')) return { rows: [memState] };
      if (sql.includes('INSERT INTO conversation_states')) return { rows: [memState] };
      if (sql.includes('FROM conversation_states')) return { rows: [memState] };
      return { rows: [] };
    });
    // The LLM turn hangs until the test releases it: the client disconnect
    // happens strictly before any model output exists.
    const gate = new Promise<LlmResponse>((resolve) => {
      releaseLlm = resolve;
    });
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const gated: LlmProvider = {
      getProviderName: () => 'gated-abort-test',
      generateResponse: async () => gate,
    } as any;
    jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(gated);

    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  const rawPost = (content: string, key: string): { req: http.ClientRequest; done: Promise<unknown> } => {
    const body = JSON.stringify({ content });
    const token = signChatToken('tester', 3600, TEST_SECRET);
    const req = http.request(
      `${baseUrl}/api/v1/conversations/conv-abort/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Idempotency-Key': key,
        },
      }
    );
    const done = new Promise<unknown>((resolve) => {
      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', (err) => resolve({ error: (err as Error).message }));
      req.on('close', () => resolve({ closed: true }));
    });
    req.end(body);
    return { req, done };
  };

  it('completes extraction, tools, and both messages after the socket is destroyed', async () => {
    const { req, done } = rawPost('Change my pickup location to Tambaram.', 'key-abort-1');

    // The server persisted the user message: the request was accepted.
    await waitFor(() => messageInserts().length >= 1, 'user message persistence');

    // Navigate away / refresh: the browser connection dies here.
    req.destroy();
    await done;

    // The model answers only after the disconnect.
    releaseLlm({ content: 'Pickup updated to Tambaram.', finishReason: 'stop' });

    // Everything the turn owns still lands: assistant row + state writes.
    await waitFor(() => messageInserts().length >= 2, 'assistant message persistence');
    await waitFor(() => stateWrites().length >= 1, 'conversation state persistence');
    await new Promise((r) => setTimeout(r, 200));

    const inserts = messageInserts();
    expect(inserts).toHaveLength(2);
    const rows = (pool.query as jest.Mock).mock.calls
      .filter(([sql]: string[]) => sql.includes('INSERT INTO conversation_messages'))
      .map(([, params]: any[]) => ({ role: params[1], content: params[2] }));
    expect(rows[0]).toMatchObject({ role: 'user', content: 'Change my pickup location to Tambaram.' });
    expect(rows[1]).toMatchObject({ role: 'assistant' });
    expect((rows[1].content as string).length).toBeGreaterThan(0);
  });

  it('replays (never duplicates) when the same key is retried after the abort', async () => {
    const first = rawPost('Change my pickup location to Tambaram.', 'key-abort-2');
    await waitFor(() => messageInserts().length >= 1, 'user message persistence');
    first.req.destroy();
    await first.done;
    releaseLlm({ content: 'Pickup updated to Tambaram.', finishReason: 'stop' });
    await waitFor(() => messageInserts().length >= 2, 'assistant message persistence');
    const insertsBefore = messageInserts().length;

    // Return-to-conversation retry with the SAME key: replay, no new rows.
    const auth = `Bearer ${signChatToken('tester', 3600, TEST_SECRET)}`;
    const retry = await request(app)
      .post('/api/v1/conversations/conv-abort/messages')
      .set('Authorization', auth)
      .set('Idempotency-Key', 'key-abort-2')
      .send({ content: 'Change my pickup location to Tambaram.' });
    expect(retry.status).toBe(201);
    expect(messageInserts().length).toBe(insertsBefore);
    expect(retry.body.data.userMessage.content).toBe('Change my pickup location to Tambaram.');
    expect(typeof retry.body.data.assistantMessage.content).toBe('string');
  });
});
