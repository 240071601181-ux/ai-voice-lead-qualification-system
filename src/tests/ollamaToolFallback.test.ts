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
  looksLikeJsonToolCall,
} from '../agent/conversationTools';
import { pool } from '../database';

jest.mock('axios');
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

  it('recognizes the tool-call shape even for unknown names (dispatcher rejects them)', () => {
    // Shape recognition is not execution permission: unknown names flow to
    // dispatchConversationTool, which rejects them, so the model retries
    // naturally instead of leaking raw JSON.
    for (const name of ['runCommand', 'queryDatabase', 'endCall', 'getVehicleTypes']) {
      const calls = extractJsonToolCallsFromContent(
        `{"name":"${name}","parameters":{}}`
      );
      expect(calls).toHaveLength(1);
      expect(calls![0].function.name).toBe(name);
    }
  });

  it('rejects everything that is not the exact tool-call shape', () => {
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

describe('malformed tool-shaped content (truncated generation)', () => {
  const TRUNCATED =
    '{"name":"updateConversationState","parameters":{"updates":{"customer_name":"","pickup_location":"","destination":""';

  it('flags truncated tool JSON without ever treating it as callable', () => {
    expect(looksLikeJsonToolCall(TRUNCATED)).toBe(true);
    expect(extractJsonToolCallsFromContent(TRUNCATED)).toBeUndefined();
  });

  it('does not flag well-formed payloads, customer JSON, or prose', () => {
    expect(
      looksLikeJsonToolCall('{"name":"updateConversationState","parameters":{"updates":{}}}')
    ).toBe(false);
    expect(looksLikeJsonToolCall('{"name":"getVehicleTypes","parameters":{}}')).toBe(false);
    expect(looksLikeJsonToolCall('{"delivery":"tomorrow","phone":"123"}')).toBe(false);
    expect(looksLikeJsonToolCall('{"name":"Ravi","city":"Chennai"}')).toBe(false);
    expect(looksLikeJsonToolCall('Hello! How can I help?')).toBe(false);
    expect(looksLikeJsonToolCall('')).toBe(false);
  });

  it('flags truncated tool-shaped content for any tool name', () => {
    expect(looksLikeJsonToolCall('{"name":"getVehicleTypes","parameters":{')).toBe(true);
    expect(looksLikeJsonToolCall('{"name":"runCommand","parameters":')).toBe(true);
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

  it('suppresses truncated tool-shaped content (never executed, never rendered)', async () => {
    const store = makeStore();
    installMock(store);
    withProvider(
      scriptedProvider(
        [
          {
            content:
              '{"name":"updateConversationState","parameters":{"updates":{"customer_name":"","pickup_location":""',
            finishReason: 'stop',
          },
        ],
        []
      )
    );

    const res = await orchestrator.processTurn({
      conversationId: 'conv-1',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: getTextToolDefinitions(),
    });

    // Nothing executed (arguments unknowable) and nothing raw survives:
    // empty content lets the controller persist its safe placeholder.
    expect(res.executedTools ?? []).toEqual([]);
    expect(res.toolCalls).toBeUndefined();
    expect(res.content).toBe('');
    expect(store.textState).toBeNull();
  });

  it('blanks content when a continuation degrades into truncated JSON (controller composes fallback)', async () => {
    const store = makeStore();
    installMock(store);
    withProvider(
      scriptedProvider(
        [
          {
            content: '{"name":"updateConversationState","parameters":{"updates":{"pickup_location":"Chennai"}}}',
            finishReason: 'stop',
          },
          {
            content: '{"name":"updateConversationState","parameters":{"updates":{"destination":"Bengal',
            finishReason: 'stop',
          },
        ],
        []
      )
    );

    const res = await orchestrator.processTurn({
      conversationId: 'conv-1',
      messages: [{ role: 'user', content: 'Chennai then Bengal' }],
      tools: getTextToolDefinitions(),
    });

    expect(res.executedTools).toEqual([{ name: 'updateConversationState', success: true }]);
    expect(store.textState.pickup_location).toBe('Chennai');
    // Blanked so the controller composes the state-grounded fallback.
    expect(res.content).toBe('');
    expect(res.toolCalls).toBeUndefined();
  });

  it('routes unknown-tool JSON to the dispatcher for rejection, then answers naturally', async () => {
    installMock(makeStore());
    withProvider(
      scriptedProvider(
        [
          { content: '{"name":"getVehicleTypes","parameters":{}}', finishReason: 'stop' },
          { content: 'We run trucks, containers, and tempos across South India.', finishReason: 'stop' },
        ],
        []
      )
    );

    const res = await orchestrator.processTurn({
      conversationId: 'conv-1',
      messages: [{ role: 'user', content: 'What vehicles do you provide?' }],
      tools: getTextToolDefinitions(),
    });

    // Rejected by the dispatcher (never executed), model retries naturally.
    expect(res.executedTools).toEqual([{ name: 'getVehicleTypes', success: false }]);
    expect(res.content).not.toContain('"parameters"');
    expect(res.content).toContain('trucks');
    expect(res.toolCalls).toBeUndefined();
  });
});

describe('Ollama continuation wire format (arguments as objects)', () => {
  const axios = require('axios') as { post: jest.Mock };

  beforeEach(() => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.LLM_MODEL = 'wire-test-model';
    process.env.LLM_BASE_URL = 'http://ollama-wire:11434';
    (axios.post as jest.Mock).mockReset();
  });

  it('forwards assistant tool_calls with object arguments (no 400)', async () => {
    (axios.post as jest.Mock).mockResolvedValueOnce({
      data: { message: { role: 'assistant', content: 'Noted.' }, done: true },
    });
    const { OllamaLlmProvider } = require('../agent/llm') as typeof import('../agent/llm');
    await new OllamaLlmProvider().generateResponse([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Pickup is Chennai' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'json_fallback_0',
          type: 'function',
          function: {
            name: 'updateConversationState',
            arguments: '{"updates":{"pickup_location":"Chennai"}}',
          },
        }],
      },
      { role: 'tool', content: 'Conversation state updated successfully' },
    ]);
    const payload = (axios.post as jest.Mock).mock.calls[0][1];
    const forwarded = payload.messages.find((m: any) => m.role === 'assistant' && m.tool_calls);
    expect(forwarded.tool_calls[0].function.arguments).toEqual({
      updates: { pickup_location: 'Chennai' },
    });
    expect(forwarded.tool_calls[0].function.name).toBe('updateConversationState');
    expect(forwarded.tool_calls[0].id).toBe('json_fallback_0');
  });

  it('falls back to {} for unparseable argument strings instead of crashing', async () => {
    (axios.post as jest.Mock).mockResolvedValueOnce({
      data: { message: { role: 'assistant', content: 'ok' }, done: true },
    });
    const { OllamaLlmProvider } = require('../agent/llm') as typeof import('../agent/llm');
    await new OllamaLlmProvider().generateResponse([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'getConversationState', arguments: 'not-json{{{' } }],
      },
    ]);
    const payload = (axios.post as jest.Mock).mock.calls[0][1];
    const forwarded = payload.messages.find((m: any) => m.role === 'assistant' && m.tool_calls);
    expect(forwarded.tool_calls[0].function.arguments).toEqual({});
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
