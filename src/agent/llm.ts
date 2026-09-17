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

/**
 * MockLlmProvider produces deterministic, offline completions and tool call requests
 * for unit/integration testing without requiring API keys.
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
 */
export class OpenAILlmProvider implements LlmProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
    this.model = model || process.env.LLM_MODEL || 'gpt-4o-mini';
  }

  getProviderName(): string {
    return 'openai';
  }

  async generateResponse(messages: LlmMessage[], tools?: LlmToolDefinition[]): Promise<LlmResponse> {
    if (!this.apiKey) {
      logger.warn('LLM_API_KEY is missing. Falling back to MockLlmProvider.');
      const mock = new MockLlmProvider();
      return mock.generateResponse(messages, tools);
    }

    try {
      const axios = require('axios');
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

      const response = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      const choice = response.data?.choices?.[0];
      const message = choice?.message || {};

      return {
        content: message.content || '',
        toolCalls: message.tool_calls || undefined,
        finishReason: choice?.finish_reason || 'stop'
      };
    } catch (err: any) {
      logger.error('Error in OpenAI LLM execution, falling back to mock provider', { error: err.message });
      const mock = new MockLlmProvider();
      return mock.generateResponse(messages, tools);
    }
  }
}

/**
 * Returns active LlmProvider based on environment configuration.
 */
export const getLlmProvider = (): LlmProvider => {
  const providerType = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
  if (providerType === 'openai') {
    return new OpenAILlmProvider();
  }
  return new MockLlmProvider();
};
