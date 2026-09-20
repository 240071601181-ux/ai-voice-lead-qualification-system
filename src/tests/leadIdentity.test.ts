/**
 * Trusted customer identity: the assistant must use the linked lead record,
 * never a hardcoded/demo name, never the operator name, never invention.
 *
 * - Static sweep: no forbidden demo identity may exist in production code
 *   paths (tests, fixtures, and mock-data folders excluded).
 * - Orchestrator: the linked lead name is injected read-only into the turn
 *   prompt; nameless leads are marked None; the never-invent rule travels
 *   with every turn.
 * - Controller: "What is my name?" resolves to the lead record through the
 *   normal turn; an explicit "my name is X" updates conversation state only
 *   (lead rows are never silently rewritten) and state wins thereafter.
 * - New conversations start with no messages and no state (nothing faked).
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { orchestrator } from '../agent/orchestrator';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { resetIdempotencyForTests } from '../services/messageIdempotency';
import { LlmMessage, LlmProvider } from '../agent/llm';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Demo names that must never appear in production code paths. */
const FORBIDDEN_IDENTITY = [
  /\bHello,\s*John\b/,
  /\bHello\s+John\b/,
  /\bWelcome to MadLead,?\s+John\b/,
  /\bCustomer John\b/,
  /\bLead John\b/,
  /the customer is John/i,
  /Punnaivanam/,
  /Acme Cargo/,
];

const PROD_DIRS = [
  'src/agent',
  'src/services',
  'src/controllers',
  'src/config',
  'src/middleware',
  'src/routes',
  'src/utils',
  'src/repositories',
  'src/database',
  'frontend/client/src/api',
  'frontend/client/src/components/app',
  'frontend/client/src/pages/conversations',
];

const listTsFiles = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
};

describe('no hardcoded customer identity in production paths', () => {
  it('finds no forbidden demo names outside tests, fixtures, and mocks', () => {
    const violations: string[] = [];
    for (const rel of PROD_DIRS) {
      const dir = path.join(PROJECT_ROOT, rel);
      if (!fs.existsSync(dir)) continue;
      for (const file of listTsFiles(dir)) {
        // Mock-data modules are display fixtures, never conversation truth.
        if (file.includes(`${path.sep}mock${path.sep}`)) continue;
        const content = fs.readFileSync(file, 'utf8');
        for (const pattern of FORBIDDEN_IDENTITY) {
          if (pattern.test(content)) {
            violations.push(`${path.relative(PROJECT_ROOT, file)} matches ${pattern}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

const TEST_SECRET = 'lead-identity-test-secret-do-not-use-in-prod';

const makeLead = (overrides: Record<string, unknown> = {}) => ({
  id: 'lead-santhosh',
  source: 'web',
  name: 'Santhosh Punnaivanam',
  phone: '+919876543210',
  email: null,
  status: 'NEW',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const makeConvo = (leadId: string | null) => ({
  id: 'conv-identity',
  lead_id: leadId,
  user_id: null,
  channel: 'web',
  status: 'active',
  started_at: new Date().toISOString(),
  ended_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

describe('linked lead identity in the agent turn', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let capturedSystem = '';
  let leadRow: Record<string, unknown> | null = null;
  let convoRow: Record<string, unknown> | null = null;
  let stateRow: Record<string, unknown> | null = null;
  let msgSeq = 0;
  let lastUserContent: string | null = null;

  const queriesOf = (needle: string): string[] =>
    (pool.query as jest.Mock).mock.calls
      .map(([sql]: string[]) => sql as string)
      .filter((sql: string) => sql.includes(needle));

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
    capturedSystem = '';
    msgSeq = 0;
    lastUserContent = null;
    leadRow = makeLead();
    convoRow = makeConvo('lead-santhosh');
    stateRow = null;
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('INSERT INTO conversations')) {
        return {
          rows: [
            {
              ...makeConvo(params[0] ?? null),
              id: 'conv-fresh',
              channel: params[1] ?? 'web',
            },
          ],
        };
      }
      if (sql.includes('FROM conversations WHERE')) return { rows: convoRow ? [convoRow] : [] };
      if (sql.includes('FROM leads WHERE')) return { rows: leadRow ? [leadRow] : [] };
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
        if (params[1] === 'user') lastUserContent = params[2];
        return { rows: [row] };
      }
      // History includes the just-persisted turn, as in production.
      if (sql.includes('FROM conversation_messages')) {
        return {
          rows:
            lastUserContent !== null
              ? [
                  {
                    id: 'msg-0',
                    conversation_id: 'conv-identity',
                    role: 'user',
                    content: lastUserContent,
                    created_at: new Date().toISOString(),
                  },
                ]
              : [],
        };
      }
      if (sql.includes('UPDATE conversation_states SET')) {
        stateRow = { ...(stateRow ?? {}), customer_name: 'Arun' };
        return { rows: [stateRow] };
      }
      if (sql.includes('INSERT INTO conversation_states')) {
        stateRow = { id: 'st-1', conversation_id: params[0] ?? 'conv-identity' };
        return { rows: [stateRow] };
      }
      if (sql.includes('FROM conversation_states')) return { rows: stateRow ? [stateRow] : [] };
      if (sql.includes('FROM users WHERE')) return { rows: [] };
      return { rows: [] };
    });
    // Capturing provider: records the assembled prompt, answers from the
    // trusted lead block only (never invents). Mirrors production, which
    // receives the same system prompt.
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const capturing: LlmProvider = {
      getProviderName: () => 'capturing-identity-test',
      generateResponse: async (messages: LlmMessage[]) => {
        capturedSystem = messages.find((m) => m.role === 'system')?.content ?? '';
        const leadLine = capturedSystem
          .split('\n')
          .find((line) => line.startsWith('- Linked Lead Name:')) ?? '';
        const name = leadLine.replace('- Linked Lead Name:', '').trim();
        const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        if (/what is my name/i.test(lastUser)) {
          return {
            content:
              name && name !== 'None — no customer name on record'
                ? `Your name is ${name}.`
                : `I don't know your name yet — may I have it?`,
            finishReason: 'stop',
          };
        }
        if (/^(hi|hello|hey)\b/i.test(lastUser.trim())) {
          return {
            content:
              name && name !== 'None — no customer name on record'
                ? `Hello ${name}! How can I help with your shipment today?`
                : `Hello! How can I help with your shipment today?`,
            finishReason: 'stop',
          };
        }
        return { content: 'Noted.', finishReason: 'stop' };
      },
    } as any;
    jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue(capturing);
  });

  const auth = () => `Bearer ${signChatToken('tester', 3600, TEST_SECRET)}`;
  const postMessage = (content: string, key: string) =>
    request(app)
      .post('/api/v1/conversations/conv-identity/messages')
      .set('Authorization', auth())
      .set('Idempotency-Key', key)
      .send({ content });

  it('injects the linked lead name read-only; never John, never invented', async () => {
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const providerSpy = jest.spyOn(llmModule, 'getLlmProvider');
    providerSpy.mockClear();
    // A content-bearing turn reaches the model with the trusted identity and
    // an explicit per-turn language directive in the assembled prompt.
    const res = await postMessage('I need a truck.', 'key-id-1');
    expect(res.status).toBe(201);
    expect(capturedSystem).toContain('LINKED LEAD IDENTITY');
    expect(capturedSystem).toContain('Santhosh Punnaivanam');
    expect(capturedSystem).toContain('LANGUAGE: The customer wrote in English. Respond in English only.');
    expect(capturedSystem).toMatch(/never invent/i);
    expect(capturedSystem).not.toMatch(/\bJohn\b/);
    expect(providerSpy).toHaveBeenCalled();
  });

  it('greets a linked lead deterministically with no LLM turn', async () => {
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const providerSpy = jest.spyOn(llmModule, 'getLlmProvider');
    providerSpy.mockClear();
    const res = await postMessage('Hi', 'key-id-1b');
    expect(res.status).toBe(201);
    expect(res.body.data.assistantMessage.content).toBe(
      'Hello Santhosh Punnaivanam! How can I help with your shipment today?'
    );
    expect(res.body.data.assistantMessage.content).not.toMatch(/\bJohn\b/);
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('greets neutrally when the lead has no name', async () => {
    leadRow = makeLead({ name: null });
    const res = await postMessage('Hi', 'key-id-2');
    expect(res.status).toBe(201);
    expect(res.body.data.assistantMessage.content).toBe(
      'Hi! How can I help with your shipment today?'
    );
  });

  it('resolves "What is my name?" from the lead record through the normal turn', async () => {
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    const providerSpy = jest.spyOn(llmModule, 'getLlmProvider');
    providerSpy.mockClear();
    const res = await postMessage('What is my name?', 'key-id-3');
    expect(res.status).toBe(201);
    // Deterministic read-only fallback: no LLM turn needed, exact lead name.
    expect(res.body.data.assistantMessage.content).toBe('Your name is Santhosh Punnaivanam.');
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('lets an explicit "my name is X" update state without touching the lead row', async () => {
    const rename = await postMessage('Actually, my name is Arun.', 'key-id-4');
    expect(rename.status).toBe(201);
    // State took the explicit correction…
    expect(stateRow).toMatchObject({ customer_name: 'Arun' });
    // …while the trusted lead row was never rewritten.
    expect(queriesOf('UPDATE leads SET')).toHaveLength(0);
    // …and the conversation now answers from state, deterministically.
    const memory = await postMessage('What is my name?', 'key-id-5');
    expect(memory.status).toBe(201);
    expect(memory.body.data.assistantMessage.content).toBe('Your name is Arun.');
  });

  it('uses the real lead name even when it is John (database truth, not hardcode)', async () => {
    leadRow = makeLead({ id: 'lead-john', name: 'John' });
    convoRow = makeConvo('lead-john');
    const res = await postMessage('Hi', 'key-id-6');
    expect(res.status).toBe(201);
    expect(res.body.data.assistantMessage.content).toBe(
      'Hello John! How can I help with your shipment today?'
    );
  });

  it('starts new conversations with no messages and no state (nothing faked)', async () => {
    convoRow = { ...makeConvo(null), id: 'conv-fresh' };
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', auth())
      .send({ channel: 'web' });
    expect(created.status).toBe(201);
    // Creation persists the conversation row only: no greeting, no slots.
    expect(queriesOf('INSERT INTO conversation_messages')).toHaveLength(0);
    expect(queriesOf('INSERT INTO conversation_states')).toHaveLength(0);
  });
});
