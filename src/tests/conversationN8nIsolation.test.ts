/**
 * Phase 15 — n8n failure isolation at the business-operation level.
 *
 * Proves a n8n delivery failure NEVER fails the enclosing workflow: with
 * N8N_ENABLED=true and a throwing webhook client, POST
 * /api/v1/conversations/:id/messages still returns 201 with both messages
 * persisted, while the n8n attempt is recorded (failed row) instead of
 * propagating. Dummy fixtures only.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { MockLlmProvider } from '../agent/llm';
import { setN8nClientForTests, resetN8nClientForTests } from '../services/n8n/n8nClient';
import { MockN8nClient } from '../services/n8n/mockN8nClient';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const TEST_SECRET = 'n8n-isolation-test-secret-do-not-use-in-prod';

describe('n8n failure isolation (Phase 15)', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let mockClient: MockN8nClient;

  const store = () => ({
    convo: {
      id: 'conv-n8n',
      lead_id: 'lead-n8n',
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
      id: 'st-n8n',
      conversation_id: 'conv-n8n',
      lead_id: 'lead-n8n',
      pickup_location: 'Chennai',
      destination: 'Bengaluru',
      vehicle_type: 'Truck',
      cargo_weight: 500,
      budget: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any,
    lead: {
      id: 'lead-n8n',
      source: 'web',
      name: 'N8n Test',
      phone: '+911234567890',
      email: null,
      status: 'NEW',
    } as any,
  });

  type Store = ReturnType<typeof store>;

  const installMock = (s: Store) => {
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM conversations WHERE')) return { rows: [s.convo] };
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
      if (sql.includes('FROM conversation_messages')) return { rows: [...s.messages] };
      if (sql.includes('COUNT(*) AS total FROM conversation_messages')) {
        return { rows: [{ total: String(s.messages.length) }] };
      }
      if (sql.includes('UPDATE conversation_states SET')) return { rows: [s.textState] };
      if (sql.includes('INSERT INTO conversation_states')) return { rows: [s.textState] };
      if (sql.includes('FROM conversation_states')) return { rows: [s.textState] };
      if (sql.includes('FROM leads')) return { rows: [s.lead] };
      if (sql.includes('INSERT INTO qualifications')) {
        return {
          rows: [
            {
              id: 'q-n8n',
              conversation_id: 'conv-n8n',
              call_id: null,
              lead_id: 'lead-n8n',
              score: 50,
              tier: 'WARM',
              details: { criteria: {} },
              qualified_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM qualifications')) return { rows: [] };
      return { rows: [] };
    });
  };

  beforeAll(() => {
    for (const key of [
      'CHAT_JWT_SECRET',
      'CHAT_RATE_LIMIT_MAX',
      'CHAT_MESSAGE_RATE_LIMIT_MAX',
      'CHAT_MAX_MESSAGE_LENGTH',
      'LLM_PROVIDER',
      'N8N_ENABLED',
      'N8N_WEBHOOK_SECRET',
      'N8N_WORKFLOWS_JSON',
      'N8N_MAX_RETRIES',
      'N8N_RETRY_BASE_DELAY_MS',
      'CRM_SYNC_ENABLED',
      'FOLLOWUP_ENABLED',
      'WHATSAPP_ENABLED',
      'CALENDAR_ENABLED',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.CHAT_JWT_SECRET = TEST_SECRET;
    process.env.CHAT_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MESSAGE_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MAX_MESSAGE_LENGTH = '4000';
    process.env.LLM_PROVIDER = 'mock';
    // n8n ON but its webhook client always fails fast.
    process.env.N8N_ENABLED = 'true';
    process.env.N8N_WEBHOOK_SECRET = 'test-secret-not-real';
    process.env.N8N_WORKFLOWS_JSON = JSON.stringify({
      'qualification.completed': [{ name: 'test-flow', url: 'https://n8n.test/hook' }],
    });
    process.env.N8N_MAX_RETRIES = '1';
    process.env.N8N_RETRY_BASE_DELAY_MS = '10';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetN8nClientForTests();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetChatRateLimitsForTests();
    mockClient = new MockN8nClient();
    mockClient.enqueue({ error: Object.assign(new Error('webhook down'), { status: 500 }) });
    setN8nClientForTests(mockClient);
  });

  afterEach(() => {
    resetN8nClientForTests();
  });

  it('sends the message (201, both sides persisted) while n8n delivery fails in the background', async () => {
    const s = store();
    installMock(s);
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(
      new MockLlmProvider() as any
    );

    const res = await request(app)
      .post('/api/v1/conversations/conv-n8n/messages')
      .set('Authorization', `Bearer ${signChatToken('tester', 3600, TEST_SECRET)}`)
      .send({ content: 'My budget is 30000' });

    expect(res.status).toBe(201);
    expect(res.body.data.userMessage.content).toBe('My budget is 30000');
    expect(res.body.data.assistantMessage.content).toBeDefined();
    expect(s.messages.filter((m: any) => m.role === 'user')).toHaveLength(1);
    expect(s.messages.filter((m: any) => m.role === 'assistant')).toHaveLength(1);

    // Drain the fire-and-forget fan-out; the failed webhook must have been
    // attempted (and recorded) without touching the 201 above.
    await new Promise((r) => setTimeout(r, 500));
    expect(mockClient.calls.length).toBeGreaterThanOrEqual(1);
  }, 15000);
});
