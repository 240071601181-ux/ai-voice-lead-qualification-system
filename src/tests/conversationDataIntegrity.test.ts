/**
 * Phase 19 — conversation-first data integrity.
 *
 * - Contact/dimension extraction is deterministic and conservative (budgets,
 *   weights, dates, and dimension fragments never parse as phone numbers).
 * - Contact details stated by the customer are progressively stored on the
 *   CURRENT conversation's linked lead only: filled when empty, corrected
 *   when explicitly restated, never invented, never written elsewhere.
 * - Shipment statements never touch lead columns.
 * - Tool calls cannot escape their trusted conversation scope.
 * - Guidance keeps collection ordered, deduplicated, and consent-safe.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { resetIdempotencyForTests } from '../services/messageIdempotency';
import { extractContactFromMessage, extractStateFromMessage } from '../agent/textStateExtraction';
import { TEXT_TURN_GUIDANCE } from '../agent/orchestrator';
import { agentConfig } from '../agent/config';
import { dispatchConversationTool } from '../agent/conversationTools';
import { LlmProvider } from '../agent/llm';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

describe('contact + dimension extraction', () => {
  it('extracts explicit email addresses', () => {
    expect(extractContactFromMessage('My email is santhosh@example.com.').email).toBe(
      'santhosh@example.com'
    );
    expect(extractContactFromMessage('Reach me at SANTHOSH@Example.COM please.').email).toBe(
      'santhosh@example.com'
    );
  });

  it('extracts Indian mobile numbers in common typed forms', () => {
    expect(extractContactFromMessage('My phone is 9876543210.').phone).toBe('+919876543210');
    expect(extractContactFromMessage('Call me on +91 98765 43210.').phone).toBe('+919876543210');
    expect(extractContactFromMessage('Phone: 91-9876543210').phone).toBe('+919876543210');
    expect(extractContactFromMessage('My number is +1 4155552671.').phone).toBe('+14155552671');
  });

  it('never mistakes budgets, weights, dates, or dimensions for phone numbers', () => {
    expect(extractContactFromMessage('My budget is 30000.')).toEqual({});
    expect(extractContactFromMessage('Budget 20000 ரூபாய்.')).toEqual({});
    expect(extractContactFromMessage('500 kg of electronics.').phone).toBeUndefined();
    expect(extractContactFromMessage('Delivery on 2026-09-20.')).toEqual({});
    expect(extractContactFromMessage('Size 10 x 20 x 30 cm.').phone).toBeUndefined();
    expect(extractContactFromMessage('Pickup Chennai, destination Bangalore.')).toEqual({});
  });

  it('extracts cargo dimensions without disturbing weight', () => {
    const update = extractStateFromMessage('Dimensions are 10 x 20 x 30 cm.');
    expect(update.cargo_dimensions).toBe('10 x 20 x 30 cm');
    expect(update.cargo_weight).toBeUndefined();
    expect(extractStateFromMessage('10x20 ft crate.').cargo_dimensions).toBe('10 x 20 ft');
  });

  it('maps bare container sizes to canonical vehicles', () => {
    expect(extractStateFromMessage('My vehicle is 14ft.').vehicle_type).toBe('14ft Container');
    expect(extractStateFromMessage('I need a truck.').vehicle_type).toBe('Truck');
    expect(extractStateFromMessage('14ft container please.').vehicle_type).toBe('14ft Container');
  });

  it('captures send/ship weight-of-cargo phrasing', () => {
    const update = extractStateFromMessage('I need to send 500 kg of electronics.');
    expect(update.cargo_weight).toBe(500);
    expect(update.cargo_type).toBe('electronics');
    expect(extractStateFromMessage('Please ship 2 tons of rice.').cargo_type).toBe('rice');
  });
});

describe('guided collection prompt (no scoring/logic change)', () => {
  const guidance = TEXT_TURN_GUIDANCE;

  it('orders collection and forbids re-asking known fields', () => {
    expect(guidance).toMatch(/natural order/i);
    expect(guidance).toMatch(/one or two questions at a time/i);
    expect(guidance).toMatch(/never re-ask/i);
  });

  it('requires asking for contact naturally and never inventing it', () => {
    expect(guidance).toMatch(/phone number or email/i);
    expect(guidance).toMatch(/never invent contact details/i);
  });

  it('forbids fabricated consent, bookings, and payments', () => {
    expect(guidance).toMatch(/never claim whatsapp consent/i);
    expect(agentConfig.systemPrompt).toMatch(/Do not invent customer information/);
    expect(agentConfig.systemPrompt).toMatch(/unless that exact name appears/);
  });
});

const TEST_SECRET = 'data-integrity-test-secret-do-not-use-in-prod';

describe('progressive lead storage from conversation turns', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let leadRow: Record<string, any> | null = null;
  const leadUpdates: Array<{ id: string; fields: Record<string, unknown> }> = [];

  const updateCalls = () =>
    (pool.query as jest.Mock).mock.calls.filter(([sql]: string[]) =>
      sql.includes('UPDATE leads SET')
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

  const convoLinked = {
    id: 'conv-lead-store',
    lead_id: 'lead-store-1',
    user_id: null,
    channel: 'web',
    status: 'active',
    started_at: new Date().toISOString(),
    ended_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as any;

  const convoUnlinked = { ...convoLinked, id: 'conv-nolead', lead_id: null };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    resetChatRateLimitsForTests();
    resetIdempotencyForTests();
    leadUpdates.length = 0;
    leadRow = {
      id: 'lead-store-1',
      source: 'web',
      name: null,
      phone: null,
      email: null,
      status: 'NEW',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM conversations WHERE')) {
        const id = params[0];
        if (id === 'conv-lead-store') return { rows: [convoLinked] };
        if (id === 'conv-nolead') return { rows: [convoUnlinked] };
        return { rows: [] };
      }
      if (sql.includes('SELECT * FROM leads WHERE')) return { rows: leadRow ? [leadRow] : [] };
      if (sql.includes('UPDATE leads SET')) {
        // UPDATE leads SET email = $1 ... WHERE id = $N RETURNING *
        const setPart = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
        const fields = setPart.split(',').map((c) => c.trim().split(' ')[0]);
        const values = params.slice(0, fields.length);
        const applied: Record<string, unknown> = {};
        fields.forEach((f, i) => {
          applied[f] = values[i];
          if (leadRow) (leadRow as any)[f] = values[i];
        });
        leadUpdates.push({ id: params[params.length - 1], fields: applied });
        return { rows: [leadRow] };
      }
      if (sql.includes('INSERT INTO conversation_messages')) {
        return {
          rows: [
            {
              id: `msg-${Math.random()}`,
              conversation_id: params[0],
              role: params[1],
              content: params[2],
              metadata: params[3],
              tool_calls: params[4],
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM conversation_messages')) return { rows: [] };
      if (sql.includes('UPDATE conversation_states SET')) return { rows: [{}] };
      if (sql.includes('INSERT INTO conversation_states')) return { rows: [{}] };
      if (sql.includes('FROM conversation_states')) return { rows: [] };
      return { rows: [] };
    });
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const scripted: LlmProvider = {
      getProviderName: () => 'scripted-integrity',
      generateResponse: async () => ({ content: 'Noted.', finishReason: 'stop' }),
    } as any;
    jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(scripted);
  });

  const auth = () => `Bearer ${signChatToken('tester', 3600, TEST_SECRET)}`;
  const postTo = (convId: string, content: string, key: string) =>
    request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', auth())
      .set('Idempotency-Key', key)
      .send({ content });

  it('stores explicitly stated email and phone on the linked lead only', async () => {
    const res = await postTo(
      'conv-lead-store',
      'My email is santhosh@example.com and my phone is 9876543210.',
      'key-contact-1'
    );
    expect(res.status).toBe(201);
    expect(updateCalls()).toHaveLength(1);
    expect(leadUpdates[0].id).toBe('lead-store-1');
    expect(leadUpdates[0].fields).toEqual({
      email: 'santhosh@example.com',
      phone: '+919876543210',
    });
  });

  it('corrects a changed number on explicit restatement, ignores silence', async () => {
    leadRow = { ...(leadRow as object), phone: '+911111111111' } as any;
    const res = await postTo('conv-lead-store', 'Actually my phone is 9876543210.', 'key-contact-2');
    expect(res.status).toBe(201);
    expect(leadUpdates[0].fields).toEqual({ phone: '+919876543210' });

    const before = updateCalls().length;
    const quiet = await postTo('conv-lead-store', 'Pickup Chennai, destination Bangalore.', 'key-contact-3');
    expect(quiet.status).toBe(201);
    expect(updateCalls()).toHaveLength(before);
  });

  it('never writes contact without a linked lead, never writes shipment into lead columns', async () => {
    const res = await postTo('conv-nolead', 'My email is santhosh@example.com.', 'key-contact-4');
    expect(res.status).toBe(201);
    expect(updateCalls()).toHaveLength(0);

    const before = updateCalls().length;
    const ship = await postTo(
      'conv-lead-store',
      'Pickup Chennai and destination Bangalore, 500 kg.',
      'key-contact-5'
    );
    expect(ship.status).toBe(201);
    // Shipment lives in conversation state; this turn wrote no lead columns.
    expect(updateCalls()).toHaveLength(before);
  });

  it('keeps tool execution scoped to the trusted conversation (prompt injection safe)', async () => {
    // LLM-supplied identities are ignored: the write must land on the
    // backend-resolved conversation id, never the attacker-supplied one.
    const outcome = await dispatchConversationTool(
      { conversationId: 'conv-lead-store', leadId: 'lead-store-1' },
      'updateConversationState',
      JSON.stringify({
        conversationId: 'conv-someone-else',
        lead_id: 'lead-someone-else',
        updates: { pickup_location: 'Chennai' },
      })
    );
    expect(outcome.success).toBe(true);
    const updateCall = (pool.query as jest.Mock).mock.calls.find(([sql]: string[]) =>
      sql.includes('UPDATE conversation_states SET')
    );
    expect(updateCall).toBeDefined();
    const params = updateCall![1] as unknown[];
    expect(params[params.length - 1]).toBe('conv-lead-store');
  });
});
