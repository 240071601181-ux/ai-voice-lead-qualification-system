import axios from 'axios';
import { getLlmConfig } from '../config';
import { logger } from '../utils/logger';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface LlmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface LlmResponse {
  content: string;
  toolCalls?: LlmToolCall[];
  finishReason?: string;
  /**
   * Phase 5: audit-safe summary of conversation-anchored tool executions
   * performed inside the orchestrator loop. Names + success flags only —
   * never arguments, identities, or raw backend errors.
   */
  executedTools?: ExecutedToolSummary[];
}

export interface ExecutedToolSummary {
  name: string;
  success: boolean;
}

export interface LlmProvider {
  getProviderName(): string;
  generateResponse(messages: LlmMessage[], tools?: LlmToolDefinition[]): Promise<LlmResponse>;
  generateStream?(messages: LlmMessage[], tools?: LlmToolDefinition[], onChunk?: (chunk: string) => void): Promise<LlmResponse>;
}

/** Clear configuration error (missing model, unsupported provider, ...). */
export class LlmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigurationError';
  }
}

/** Upstream request failure. Never carries keys, URLs with credentials, or bodies. */
export class LlmRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmRequestError';
  }
}

/**
 * MockLlmProvider produces deterministic, offline completions and tool call requests
 * for unit/integration testing without requiring API keys.
 *
 * TESTS ONLY. Select explicitly with `LLM_PROVIDER=mock`. It is never the
 * runtime default — getLlmProvider() resolves an unset LLM_PROVIDER to the
 * real Ollama provider instead.
 */
export class MockLlmProvider implements LlmProvider {
  getProviderName(): string {
    return 'mock';
  }

  async generateResponse(messages: LlmMessage[], tools?: LlmToolDefinition[]): Promise<LlmResponse> {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';

    // Check if system prompt contains RAG retrieved context
    const hasRagContext = systemMsg.includes('Company Knowledge Base Context') || systemMsg.includes('RETRIEVED KNOWLEDGE');

    let content = 'Thank you for reaching out to our logistics service. How can I assist you with your shipment today?';

    const lowerInput = lastUserMsg.toLowerCase();

    if (lowerInput.includes('namaste') || lowerInput.includes('kaise') || lowerInput.includes('hindi')) {
      content = 'Namaste! Hum aapke logistics aur shipping ki zaroorat mein poori madad karenge. Aap kahan se cargo bhejna chahte hain?';
    } else if (lowerInput.includes('vanakkam') || lowerInput.includes('tamil') || lowerInput.includes('eppadi')) {
      content = 'Vanakkam! Ungal logistics devaiyabai kettukolla virumbugirom. Pickup location enna?';
    } else if (hasRagContext) {
      content = 'Based on our company policy and knowledge base, standard delivery for interstate shipments is within 48 hours with full cargo tracking.';
    } else if (lowerInput.includes('chennai') || lowerInput.includes('pickup')) {
      content = 'Got it. Pickup location is noted as Chennai. What is the destination city and estimated weight of your cargo?';
    } else if (lowerInput.includes('bengaluru') || lowerInput.includes('destination')) {
      content = 'Destination Bengaluru recorded. What type of vehicle (e.g. 14ft container, truck) do you require?';
    }

    return {
      content,
      finishReason: 'stop'
    };
  }

  async generateStream(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
    onChunk?: (chunk: string) => void
  ): Promise<LlmResponse> {
    const response = await this.generateResponse(messages, tools);
    if (onChunk && response.content) {
      const words = response.content.split(' ');
      for (const word of words) {
        onChunk(word + ' ');
      }
    }
    return response;
  }
}

/**
 * OpenAILlmProvider calls OpenAI Chat Completions API.
 * Failures throw (never silently fall back to mock) so misconfiguration
 * surfaces instead of masquerading as a working assistant.
 */
export class OpenAILlmProvider implements LlmProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(apiKey?: string, model?: string, baseUrl?: string) {
    const cfg = getLlmConfig();
    this.apiKey = apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
    this.model = model || cfg.model || 'gpt-4o-mini';
    this.baseUrl = (baseUrl || process.env.LLM_BASE_URL || cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.timeoutMs = cfg.timeoutMs;
  }

  getProviderName(): string {
    return 'openai';
  }

  async generateResponse(messages: LlmMessage[], tools?: LlmToolDefinition[]): Promise<LlmResponse> {
    if (!this.apiKey) {
      throw new LlmConfigurationError(
        'LLM_API_KEY (or OPENAI_API_KEY) is not set for LLM_PROVIDER=openai.'
      );
    }

    try {
      const payload: any = {
        model: this.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.name ? { name: m.name } : {}),
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {})
        }))
      };

      if (tools && tools.length > 0) {
        payload.tools = tools;
      }

      const response = await axios.post(`${this.baseUrl}/chat/completions`, payload, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeoutMs,
      });

      const choice = response.data?.choices?.[0];
      const message = choice?.message || {};

      return {
        content: message.content || '',
        toolCalls: message.tool_calls || undefined,
        finishReason: choice?.finish_reason || 'stop'
      };
    } catch (err: any) {
      if (err instanceof LlmConfigurationError) throw err;
      // Never include the key, request body, or upstream payload in the error.
      const status = err?.response?.status;
      logger.error('OpenAI LLM request failed', { status: status ?? null });
      throw new LlmRequestError(
        status ? `OpenAI request failed with status ${status}.` : 'OpenAI request failed.'
      );
    }
  }
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ id?: string; type?: string; function: { name: string; arguments: unknown } }>;
}

/**
 * OllamaLlmProvider calls the standard Ollama HTTP API (`POST /api/chat`).
 *
 * Configuration (env-driven, never hardcoded credentials):
 *   LLM_PROVIDER=ollama            (also the default when unset)
 *   LLM_MODEL=<ollama model tag>   (required — fails clearly when missing)
 *   LLM_BASE_URL=<ollama URL>      (local default; remote/ngrok URL supported)
 *   LLM_TIMEOUT_MS=<ms>            (default 90000 — local inference is slow)
 *   LLM_TEMPERATURE=<0-2>          (default 0.2 for deterministic parsing)
 *
 * Supports system/user/assistant/tool messages, bounded chronological
 * history (bounded upstream by the orchestrator), and OpenAI-style function
 * tools, which Ollama accepts on `/api/chat`. The final assistant text comes
 * from the real model response. Failures throw — never a mock fallback.
 */
export class OllamaLlmProvider implements LlmProvider {
  private model: string;
  private baseUrl: string;
  private timeoutMs: number;
  private temperature: number;

  constructor(model?: string, baseUrl?: string, timeoutMs?: number) {
    const cfg = getLlmConfig();
    const resolvedModel = (model || cfg.model || '').trim();
    if (!resolvedModel) {
      throw new LlmConfigurationError(
        'LLM_MODEL is not set for LLM_PROVIDER=ollama. Set LLM_MODEL to your Ollama model tag.'
      );
    }
    this.model = resolvedModel;
    this.baseUrl = (baseUrl || cfg.baseUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs ?? cfg.timeoutMs;
    this.temperature = cfg.temperature;
  }

  getProviderName(): string {
    return 'ollama';
  }

  /** LlmMessage → Ollama /api/chat message (role + content only, no DB metadata). */
  toOllamaMessages(messages: LlmMessage[]): OllamaChatMessage[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, content: m.content ?? '' };
      }
      if (m.role === 'assistant' && m.tool_calls) {
        // Ollama-native shape: function.arguments must be an OBJECT.
        // The internal LlmToolCall representation carries arguments as a
        // JSON string (OpenAI style); echoing that back verbatim makes
        // /api/chat reject the continuation with 400, so parse it here.
        const toolCalls = (m.tool_calls as any[]).map((tc: any) => {
          const rawArgs = tc?.function?.arguments;
          let args: unknown = {};
          if (typeof rawArgs === 'string') {
            try {
              args = rawArgs.trim().length > 0 ? JSON.parse(rawArgs) : {};
            } catch {
              args = {};
            }
          } else if (rawArgs && typeof rawArgs === 'object') {
            args = rawArgs;
          }
          return {
            ...tc,
            function: { ...(tc?.function ?? {}), name: tc?.function?.name, arguments: args },
          };
        });
        return {
          role: 'assistant' as const,
          content: m.content ?? '',
          tool_calls: toolCalls as OllamaChatMessage['tool_calls'],
        };
      }
      return { role: m.role as 'system' | 'user' | 'assistant', content: m.content ?? '' };
    });
  }

  /** Ollama tool_calls → LlmToolCall[] (arguments normalised to a JSON string). */
  toLlmToolCalls(raw: unknown): LlmToolCall[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    const calls: LlmToolCall[] = [];
    raw.forEach((tc: any, index: number) => {
      const name = tc?.function?.name;
      if (typeof name !== 'string' || name.trim().length === 0) return;
      const args = tc?.function?.arguments;
      calls.push({
        id: typeof tc?.id === 'string' && tc.id.length > 0 ? tc.id : `call_${index}`,
        type: 'function',
        function: {
          name,
          arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
        },
      });
    });
    return calls.length > 0 ? calls : undefined;
  }

  async generateResponse(messages: LlmMessage[], tools?: LlmToolDefinition[]): Promise<LlmResponse> {
    const payload: Record<string, unknown> = {
      model: this.model,
      messages: this.toOllamaMessages(messages),
      stream: false,
      options: { temperature: this.temperature },
    };
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    try {
      const response = await axios.post(`${this.baseUrl}/api/chat`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: this.timeoutMs,
      });
      const message = response.data?.message ?? {};
      const content = typeof message.content === 'string' ? message.content : '';
      return {
        content,
        toolCalls: this.toLlmToolCalls(message.tool_calls),
        finishReason: response.data?.done === true ? 'stop' : response.data?.done_reason || 'stop',
      };
    } catch (err: any) {
      if (err instanceof LlmConfigurationError) throw err;
      const status = err?.response?.status;
      // Never log URLs with credentials, keys, models, or message content.
      logger.error('Ollama LLM request failed', { status: status ?? null });
      throw new LlmRequestError(
        status
          ? `Ollama request failed with status ${status}.`
          : 'Ollama request failed. Is the Ollama server running and LLM_BASE_URL correct?'
      );
    }
  }

  async generateStream(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
    onChunk?: (chunk: string) => void
  ): Promise<LlmResponse> {
    // Non-streaming request, then replay content as chunks (no fake text).
    const response = await this.generateResponse(messages, tools);
    if (onChunk && response.content) {
      const words = response.content.split(' ');
      for (const word of words) {
        onChunk(word + ' ');
      }
    }
    return response;
  }
}

/**
 * Returns the active LlmProvider based on environment configuration.
 *
 * - `LLM_PROVIDER=mock` → MockLlmProvider (explicit, tests only).
 * - `LLM_PROVIDER=openai` → OpenAILlmProvider.
 * - `LLM_PROVIDER=ollama` or unset → OllamaLlmProvider (real runtime default).
 * - Anything else → throws a clear configuration error.
 *
 * Mock is NEVER the silent default: an unset LLM_PROVIDER resolves to the
 * real Ollama provider, and an unknown value fails fast instead of
 * masquerading as a working assistant.
 */
export const getLlmProvider = (): LlmProvider => {
  const cfg = getLlmConfig();
  if (cfg.provider === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('LLM_PROVIDER=mock is for tests only; mock responses in production.');
    }
    return new MockLlmProvider();
  }
  if (cfg.provider === 'openai') {
    return new OpenAILlmProvider();
  }
  return new OllamaLlmProvider();
};
