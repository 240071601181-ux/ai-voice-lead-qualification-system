/**
 * Real-LLM wiring tests: Ollama provider request/response, runtime provider
 * selection (mock never the silent default), failure handling, and the
 * surrounding text-conversation contracts (history, state, RAG, tools).
 *
 * HTTP is mocked at the axios boundary — no running Ollama instance needed.
 */
import axios from 'axios';

jest.mock('axios');
const mockPost = axios.post as unknown as jest.Mock;

import {
  LlmConfigurationError,
  LlmRequestError,
  MockLlmProvider,
  OllamaLlmProvider,
  OpenAILlmProvider,
  getLlmProvider,
} from '../agent/llm';
import { getLlmConfig } from '../config';
import { isKnowledgeSearchRequired, limitContextMessages } from '../agent/orchestrator';
import {
  extractStateFromMessage,
  mergeTextConversationState,
  validateTextStateUpdate,
} from '../agent/textStateExtraction';
import {
  TEXT_TOOL_NAMES,
  getTextToolDefinitions,
  isTextToolName,
  parseConversationToolArguments,
} from '../agent/conversationTools';

const OLD_ENV = process.env;

const setLlmEnv = (vars: Record<string, string | undefined>) => {
  process.env = { ...OLD_ENV };
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  process.env = OLD_ENV;
});

describe('runtime provider selection (mock never the silent default)', () => {
  it('defaults to the real ollama provider when LLM_PROVIDER is unset', () => {
    setLlmEnv({ LLM_PROVIDER: undefined, LLM_MODEL: 'test-model', LLM_BASE_URL: 'http://127.0.0.1:11434' });
    const provider = getLlmProvider();
    expect(provider.getProviderName()).toBe('ollama');
  });

  it('keeps mock explicitly selectable for tests', () => {
    setLlmEnv({ LLM_PROVIDER: 'mock' });
    const provider = getLlmProvider();
    expect(provider).toBeInstanceOf(MockLlmProvider);
    expect(provider.getProviderName()).toBe('mock');
  });

  it('selects openai when explicitly configured', () => {
    setLlmEnv({ LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-4o-mini', LLM_API_KEY: 'test-key' });
    expect(getLlmProvider().getProviderName()).toBe('openai');
  });

  it('fails clearly on unknown providers instead of silent mock', () => {
    setLlmEnv({ LLM_PROVIDER: 'mystery' });
    expect(() => getLlmProvider()).toThrow(/Unsupported LLM_PROVIDER/);
  });

  it('exposes provider config without secrets', () => {
    setLlmEnv({ LLM_PROVIDER: 'ollama', LLM_MODEL: 'm', LLM_BASE_URL: 'http://ollama:11434' });
    const cfg = getLlmConfig();
    expect(cfg.provider).toBe('ollama');
    expect(cfg.mockExplicit).toBe(false);
    expect(JSON.stringify(cfg)).not.toContain('test-secret-key');
  });
});

describe('Ollama provider request', () => {
  const env = () => setLlmEnv({
    LLM_PROVIDER: 'ollama',
    LLM_MODEL: 'test-model',
    LLM_BASE_URL: 'http://ollama-host:11434',
  });

  it('posts system/user/assistant history + tools to /api/chat with stream:false', async () => {
    env();
    mockPost.mockResolvedValueOnce({ data: { message: { role: 'assistant', content: 'Hello!' }, done: true } });
    const tools = getTextToolDefinitions().slice(0, 1);
    const res = await new OllamaLlmProvider().generateResponse(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello, how can I help?' },
        { role: 'user', content: 'Pickup is Chennai' },
      ],
      tools
    );
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, payload] = mockPost.mock.calls[0];
    expect(url).toBe('http://ollama-host:11434/api/chat');
    expect(payload.model).toBe('test-model');
    expect(payload.stream).toBe(false);
    expect(payload.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(payload.tools).toEqual(tools);
    expect(res.content).toBe('Hello!');
    expect(res.finishReason).toBe('stop');
  });

  it('forwards tool-role messages and assistant tool_calls without DB metadata', async () => {
    env();
    mockPost.mockResolvedValueOnce({ data: { message: { role: 'assistant', content: 'Done.' }, done: true } });
    await new OllamaLlmProvider().generateResponse([
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'getConversationState', arguments: '{}' } }] },
      { role: 'tool', content: '{"pickup_location":"Chennai"}', tool_call_id: 'tc-1' },
    ]);
    const payload = mockPost.mock.calls[0][1];
    const toolMsg = payload.messages.find((m: any) => m.role === 'tool');
    expect(toolMsg.content).toBe('{"pickup_location":"Chennai"}');
    expect(toolMsg).not.toHaveProperty('tool_call_id');
    expect(JSON.stringify(payload)).not.toContain('conversation_id');
  });

  it('supports local and remote base URLs (trailing slash tolerated)', async () => {
    setLlmEnv({ LLM_PROVIDER: 'ollama', LLM_MODEL: 'm', LLM_BASE_URL: 'https://remote-ngrok.example:443/' });
    mockPost.mockResolvedValueOnce({ data: { message: { role: 'assistant', content: 'ok' }, done: true } });
    await new OllamaLlmProvider().generateResponse([{ role: 'user', content: 'hi' }]);
    expect(mockPost.mock.calls[0][0]).toBe('https://remote-ngrok.example:443/api/chat');
  });

  it('requires LLM_MODEL with a clear configuration error', () => {
    setLlmEnv({ LLM_PROVIDER: 'ollama', LLM_MODEL: undefined, LLM_BASE_URL: 'http://127.0.0.1:11434' });
    expect(() => new OllamaLlmProvider()).toThrow(LlmConfigurationError);
  });
});

describe('Ollama response parsing', () => {
  beforeEach(() => setLlmEnv({
    LLM_PROVIDER: 'ollama', LLM_MODEL: 'm', LLM_BASE_URL: 'http://127.0.0.1:11434',
  }));

  it('parses assistant text from the real model verbatim', async () => {
    mockPost.mockResolvedValueOnce({
      data: { message: { role: 'assistant', content: 'Pickup noted as Chennai. Where to?' }, done: true },
    });
    const res = await new OllamaLlmProvider().generateResponse([{ role: 'user', content: 'Chennai' }]);
    expect(res.content).toBe('Pickup noted as Chennai. Where to?');
    expect(res.toolCalls).toBeUndefined();
  });

  it('normalises object tool arguments to JSON strings with stable ids', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { function: { name: 'updateConversationState', arguments: { updates: { pickup_location: 'Chennai' } } } },
            { id: 'abc', function: { name: 'getConversationState', arguments: '{}' } },
          ],
        },
        done: true,
      },
    });
    const res = await new OllamaLlmProvider().generateResponse([{ role: 'user', content: 'x' }]);
    expect(res.toolCalls).toEqual([
      { id: 'call_0', type: 'function', function: { name: 'updateConversationState', arguments: '{"updates":{"pickup_location":"Chennai"}}' } },
      { id: 'abc', type: 'function', function: { name: 'getConversationState', arguments: '{}' } },
    ]);
  });

  it('drops nameless tool calls instead of crashing', async () => {
    mockPost.mockResolvedValueOnce({
      data: { message: { role: 'assistant', content: 'hi', tool_calls: [{ function: { name: '', arguments: '{}' } }] }, done: true },
    });
    const res = await new OllamaLlmProvider().generateResponse([{ role: 'user', content: 'hi' }]);
    expect(res.toolCalls).toBeUndefined();
    expect(res.content).toBe('hi');
  });
});

describe('LLM failure handling (no mock fallback)', () => {
  it('ollama network failure throws LlmRequestError', async () => {
    setLlmEnv({ LLM_PROVIDER: 'ollama', LLM_MODEL: 'm', LLM_BASE_URL: 'http://127.0.0.1:11434' });
    mockPost.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(
      new OllamaLlmProvider().generateResponse([{ role: 'user', content: 'hi' }])
    ).rejects.toBeInstanceOf(LlmRequestError);
  });

  it('openai without a key throws a configuration error (never mock)', async () => {
    setLlmEnv({ LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-4o-mini', LLM_API_KEY: undefined, OPENAI_API_KEY: undefined });
    await expect(
      new OpenAILlmProvider().generateResponse([{ role: 'user', content: 'hi' }])
    ).rejects.toBeInstanceOf(LlmConfigurationError);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('real conversation history contract', () => {
  it('bounds chronological history without duplicating system messages', () => {
    const history = Array.from({ length: 40 }, (_, i) => ({ role: 'user' as const, content: `m${i}` }));
    const bounded = limitContextMessages(
      [{ role: 'system' as const, content: 'old-system' }, ...history],
      30
    );
    expect(bounded).toHaveLength(30);
    // Orchestrator strips system rows before prepending the assembled prompt;
    // the window itself must not invent or duplicate content.
    expect(bounded.filter((m) => m.role === 'system')).toHaveLength(0);
    expect(bounded[bounded.length - 1].content).toBe('m39');
  });
});

describe('state extraction with real-model-independent heuristics', () => {
  it('extracts pickup + destination, then honours a pickup correction', () => {
    const first = extractStateFromMessage('My pickup is Chennai and destination is Bengaluru.');
    expect(first.pickup_location).toBe('Chennai');
    expect(first.destination).toBe('Bengaluru');

    const merged = mergeTextConversationState(first, extractStateFromMessage('Actually pickup is Tambaram.'));
    expect(merged.pickup_location).toBe('Tambaram');
    expect(merged.destination).toBe('Bengaluru');
  });

  it('validates LLM-produced JSON through the same validator', () => {
    const validated = validateTextStateUpdate({ pickup_location: 'Chennai', budget: '25000', bogus: 'x' });
    expect(validated.sanitized).toEqual({ pickup_location: 'Chennai', budget: 25000 });
    expect(validated.sanitized).not.toHaveProperty('bogus');
  });
});

describe('RAG context contract', () => {
  it('retrieves for knowledge questions but not trivial greetings', () => {
    expect(isKnowledgeSearchRequired('What vehicles do you provide?')).toBe(true);
    expect(isKnowledgeSearchRequired('Hi')).toBe(false);
    expect(isKnowledgeSearchRequired('hi')).toBe(false);
  });
});

describe('tool-call compatibility with the real model', () => {
  it('exposes only the allowlisted text tools (no SQL/shell/endCall)', () => {
    expect(TEXT_TOOL_NAMES).toContain('updateConversationState');
    expect(TEXT_TOOL_NAMES).toContain('getConversationState');
    expect(TEXT_TOOL_NAMES).toContain('updateLeadInformation');
    for (const forbidden of ['endCall', 'queryDatabase', 'executeSQL', 'runCommand', 'fetchURL']) {
      expect(isTextToolName(forbidden)).toBe(false);
    }
    const defs = getTextToolDefinitions();
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) expect(isTextToolName(d.function.name)).toBe(true);
  });

  it('parses real-model JSON-string tool arguments', () => {
    expect(
      parseConversationToolArguments('{"updates":{"pickup_location":"Chennai"}}')
    ).toEqual({ updates: { pickup_location: 'Chennai' } });
    expect(parseConversationToolArguments('not json')).toBeNull();
  });
});
