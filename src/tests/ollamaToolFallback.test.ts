/**
 * Ollama JSON-text tool-call fallback (llama3.2 emits tool calls as
 * assistant content JSON instead of structured `tool_calls`).
 *
 * Proves:
 * - strict parser recognizes ONLY the exact allowlisted structure
 *   ({name, parameters|arguments} + optional id; allowlisted name; object args)
 * - arbitrary/malformed/customer JSON stays plain text
 * - recognized calls execute through the EXISTING dispatcher/validator
 * - raw JSON never reaches the final assistant content
 * - tool results feed back into the next LLM turn; multi-round works
 * - unknown tools + invalid args + identity injection stay rejected
 * - the legacy Vapi/call path is untouched (no auto-execution there)
 */
import { orchestrator } from '../agent/orchestrator';
import { LlmProvider, LlmResponse } from '../agent/llm';
import {
  dispatchConversationTool,
  extractJsonToolCallsFromContent,
  getTextToolDefinitions,
} from '../agent/conversationTools';
import { pool } from '../database';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

// ---------------------------------------------------------------------------
// Minimal in-memory backend for text-state tools.
// ---------------------------------------------------------------------------
const makeStore = () => ({
  textState: null as any,
});

type Store = ReturnType<typeof makeStore>;

const installMock = (store: Store) => {
  (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
    if (sql.includes('INSERT INTO conversation_states')) {
      store.textState = store.textState || {
        id: 'st-1',
        conversation_id: params[0],
        lead_id: params[1] || null,
        pickup_location: null,
        destination: null,
        cargo_weight: null,
        vehicle_type: null,
        budget: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return { rows: [store.textState] };
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
      return { rows: [store.textState] };
    }
    if (sql.includes('FROM conversation_states')) {
      return { rows: store.textState ? [store.textState] : [] };
    }
    return { rows: [] };
  });
};

/** Scripted provider that also records every turn's messages. */
const scriptedProvider = (script: LlmResponse[], seen: any[][]): LlmProvider => {
  let i = 0;
  return {
    getProviderName: () => 'scripted-fallback-test',
    generateResponse: async (messages) => {
      seen.push(JSON.parse(JSON.stringify(messages)));
      const next = script[Math.min(i, script.length - 1)];
      i += 1;
      return JSON.parse(JSON.stringify(next));
    },
  };
};

const llmModule = () => require('../agent/llm') as typeof import('../agent/llm');

describe('strict JSON-text tool-call parser', () => {
  it('recognizes the exact llama3.2 shape (name + parameters)', () => {
    const calls = extractJsonToolCallsFromContent(
      '{"name":"updateConversationState","parameters":{"updates":{"pickup_location":"Chennai","destination":"Bengaluru","cargo_weight":"500"}}}'
    );
    expect(calls).toHaveLength(1);
    expect(calls![0].function.name).toBe('updateConversationState');
    expect(JSON.parse(calls![0].function.arguments)).toEqual({
      updates: { pickup_location: 'Chennai', destination: 'Bengaluru', cargo_weight: '500' },
    });
    expect(calls![0].type).toBe('function');
  });

  it('accepts the arguments variant, custom id, and a single code fence', () => {
    const viaArgs = extractJsonToolCallsFromContent(
      '{"name":"getConversationState","arguments":{}}'
    );
    expect(viaArgs![0].function.name).toBe('getConversationState');
    const withId = extractJsonToolCallsFromContent(
      '{"id":"tc-9","name":"getConversationState","parameters":{}}'
    );
    expect(withId![0].id).toBe('tc-9');
    const fenced = extractJsonToolCallsFromContent(
      '```json\n{"name":"getConversationState","parameters":{}}\n```'
    );
    expect(fenced).toHaveLength(1);
  });

  it('rejects everything that is not the exact allowlisted structure', () => {
    const notCalls = [
      'not json at all',
      '{"name":',
      '[1,2,3]',
      '"just a string"',
      'null',
      '42',
      '',
      '   ',
      null,
      undefined,
      42,
      // Unknown tool: never auto-recognized.
      '{"name":"runCommand","parameters":{"cmd":"ls"}}',
      '{"name":"queryDatabase","parameters":{"sql":"SELECT 1"}}',
      '{"name":"endCall","parameters":{}}',
      // Extra top-level keys disqualify.
      '{"name":"updateConversationState","parameters":{"updates":{}},"extra":1}',
      '{"name":"updateConversationState","parameters":{"updates":{}},"content":"hi"}',
      // Missing pieces.
      '{"name":"updateConversationState"}',
      '{"parameters":{"updates":{}}}',
      '{"name":"","parameters":{}}',
      '{"name":42,"parameters":{}}',
      // Arguments must be an object.
      '{"name":"updateConversationState","parameters":"Chennai"}',
      '{"name":"updateConversationState","parameters":null}',
      '{"name":"updateConversationState","parameters":[1]}',
      // Ordinary customer JSON stays text.
      '{"delivery":"tomorrow","phone":"123"}',
      '{"name":"Ravi","city":"Chennai"}',
      // Embedded JSON stays text (whole content must be the payload).
      'Sure! {"name":"getConversationState","parameters":{}}',
      'Here: {"name":"getConversationState","parameters":{}} done',
    ];
    for (const candidate of notCalls) {
      expect(extractJsonToolCallsFromContent(candidate)).toBeUndefined();
    }
  });
});

describe('dispatcher enforcement behind the fallback (existing validator)', () => {
  const ctx = { conversationId: 'conv-1', leadId: null };

  it('rejects unknown tools and invalid arguments', async () => {
    const unknown = await dispatchConversationTool(ctx, 'runCommand', '{}');
    expect(unknown.success).toBe(false);
    const badArgs = await dispatchConversationTool(
      ctx,
      'updateConversationState',
      JSON.stringify({ updates: { pickup_location: '' } })
    );
    expect(badArgs.success).toBe(false);
  });

  it('blocks identity injection smuggled inside fallback-shaped args', async () => {
    const injected = await dispatchConversationTool(
      ctx,
      'updateConversationState',
      JSON.stringify({ updates: { lead_id: 'lead-evil', pickup_location: 'Chennai' } })
    );
    expect(injected.success).toBe(false);
    expect(injected.resultText).toMatch(/Identity/i);
  });
});

describe('orchestrator JSON-text tool loop (text turns)', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ['LLM_PROVIDER', 'CHAT_MAX_TOOL_ROUNDS']) savedEnv[key] = process.env[key];
    process.env.LLM_PROVIDER = 'mock';
    delete process.env.CHAT_MAX_TOOL_ROUNDS;
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
  });

  const withProvider = (provider: LlmProvider) =>
    jest.spyOn(llmModule(), 'getLlmProvider').mockReturnValue(provider);

  it('executes a JSON-text tool call and returns natural language (no raw JSON)', async () => {
    const store = makeStore();
    installMock(store);
    const seen: any[][] = [];
    withProvider(
      scriptedProvider(
        [
          {
            content:
              '{"name":"updateConversationState","parameters":{"updates":{"pickup_location":"Chennai","destination":"Bengaluru","cargo_weight":"500"}}}',
            finishReason: 'stop',
          },
          {
            content: 'Got it — 500 kg from Chennai to Bengaluru is noted. What vehicle do you need?',
            finishReason: 'stop',
          },
        ],
        seen
      )
    );

    const res = await orchestrator.processTurn({
      conversationId: 'conv-1',
      messages: [{ role: 'user', content: 'I need to transport 500 kg from Chennai to Bengaluru.' }],
      tools: getTextToolDefinitions(),
    });

    // Tool executed through the real dispatcher + validator.
    expect(res.executedTools).toEqual([{ name: 'updateConversationState', success: true }]);
    expect(store.textState.pickup_location).toBe('Chennai');
    expect(store.textState.destination).toBe('Bengaluru');
    expect(store.textState.cargo_weight).toBe(500);
    // Raw JSON never reaches the customer.
    expect(res.content).not.toContain('"name"');
    expect(res.content).not.toContain('"parameters"');
    expect(res.content).toContain('Bengaluru');
    expect(res.toolCalls).toBeUndefined();
    // Tool result was fed back to the model as a tool message.
    const secondTurn = seen[1];
    const toolMsg = secondTurn.find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toMatch(/updated successfully/i);
  });

  it('supports multiple JSON-text tool rounds within the budget', async () => {
    const store = makeStore();
    installMock(store);
    const seen: any[][] = [];
    withProvider(
      scriptedProvider(
        [
          { content: '{"name":"updateConversationState","parameters":{"updates":{"pickup_location":"Tambaram"}}}', finishReason: 'stop' },
          { content: '{"name":"getConversationState","parameters":{}}', finishReason: 'stop' },
          { content: 'Done — pickup is now Tambaram, destination Bengaluru.', finishReason: 'stop' },
        ],
        seen
      )
    );

    const res = await orchestrator.processTurn({
      conversationId: 'conv-1',
      messages: [{ role: 'user', content: 'Actually pickup should be Tambaram.' }],
      tools: getTextToolDefinitions(),
    });

    expect(res.executedTools).toEqual([
      { name: 'updateConversationState', success: true },
      { name: 'getConversationState', success: true },
    ]);
    expect(store.textState.pickup_location).toBe('Tambaram');
    expect(res.content).not.toContain('"parameters"');
    expect(seen.length).toBe(3);
  });

  it('keeps invalid-argument JSON calls fail-safe with a natural response', async () => {
    const store = makeStore();
    installMock(store);
    withProvider(
      scriptedProvider(
        [
          { content: '{"name":"updateConversationState","parameters":{"updates":{"pickup_location":""}}}', finishReason: 'stop' },
          { content: 'I could not save that — could you repeat the pickup location?', finishReason: 'stop' },
        ],
        []
      )
    );

    const res = await orchestrator.processTurn({
      conversationId: 'conv-1',
      messages: [{ role: 'user', content: 'pickup is nowhere' }],
      tools: getTextToolDefinitions(),
    });

    expect(res.executedTools).toEqual([{ name: 'updateConversationState', success: false }]);
    expect(res.content).not.toContain('"parameters"');
  });

  it('leaves unknown-tool JSON as plain text (never auto-executed)', async () => {
    installMock(makeStore());
    withProvider(
      scriptedProvider(
        [{ content: '{"name":"runCommand","parameters":{"cmd":"ls"}}', finishReason: 'stop' }],
        []
      )
    );

    const res = await orchestrator.processTurn({
      conversationId: 'conv-1',
      messages: [{ role: 'user', content: 'run something' }],
      tools: getTextToolDefinitions(),
    });

    expect(res.executedTools ?? []).toEqual([]);
    expect(res.toolCalls).toBeUndefined();
  });
});

describe('legacy Vapi/call path untouched', () => {
  it('does not auto-execute JSON-text content on call-anchored turns', async () => {
    installMock(makeStore());
    const seen: any[][] = [];
    const provider = scriptedProvider(
      [{ content: '{"name":"updateConversationState","parameters":{"updates":{"pickup_location":"Chennai"}}}', finishReason: 'stop' }],
      seen
    );
    jest.spyOn(llmModule(), 'getLlmProvider').mockReturnValue(provider);

    const res = await orchestrator.processTurn({
      callId: 'call-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
    });

    // Returned verbatim for server-side handling, exactly as before.
    expect(res.content).toContain('"parameters"');
    expect(res.executedTools ?? []).toEqual([]);
    expect(seen.length).toBe(1);
  });
});
