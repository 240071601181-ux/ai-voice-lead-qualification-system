import { agentConfig } from './config';
import { getAgentPromptContext } from '../services/agentConfigService';
import { getLlmProvider, LlmMessage, LlmResponse, LlmToolDefinition } from './llm';
import { getStateByCallId, getStateByConversationId } from '../services/conversationStateService';
import {
  AgentContext,
  ConversationChannel,
  resolveAgentIdentity,
} from './conversation';
import { searchKnowledge } from '../services/knowledgeService';
import { logger } from '../utils/logger';

export interface ProcessTurnOptions {
  /** Preferred identity for text conversations (Phase 1). */
  conversationId?: string;
  /** Legacy identity for voice/Vapi calls (compatibility, do not remove yet). */
  callId?: string;
  /** Optional transport-independent context; explicit options above take precedence. */
  context?: AgentContext;
  /** Transport channel for this turn (informational in Phase 1). */
  channel?: ConversationChannel;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  stream?: boolean;
  onStreamChunk?: (chunk: string) => void;
}

/**
 * Checks whether user query requires company-specific knowledge search.
 * Only triggers RAG search when factual knowledge/policy terms are asked.
 */
export const isKnowledgeSearchRequired = (text: string): boolean => {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  const keywords = [
    'policy', 'sop', 'standard', 'rule', 'rate', 'guideline', 'restriction',
    'term', 'condition', 'timing', 'guarantee', 'cancellation', 'procedure',
    'hours', 'delivery time', 'tracking', 'cargo rule', 'what is the policy'
  ];
  return keywords.some(kw => lower.includes(kw));
};

export class AgentOrchestrator {
  /**
   * Process a normalized turn in a Vapi-independent manner.
   */
  async processTurn(options: ProcessTurnOptions): Promise<LlmResponse> {
    const { messages, tools, stream, onStreamChunk } = options;
    // Explicit turn options win; the reusable context object fills the gaps.
    const effectiveContext: AgentContext = {
      conversationId: options.conversationId ?? options.context?.conversationId ?? null,
      callId: options.callId ?? options.context?.callId ?? null,
      leadId: options.context?.leadId ?? null,
      channel: options.channel ?? options.context?.channel ?? null,
    };
    const identity = resolveAgentIdentity(effectiveContext);
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    logger.info('AgentOrchestrator processing turn', {
      conversationId: identity.conversationId ?? null,
      callId: identity.callId ?? null,
      channel: effectiveContext.channel ?? null,
      userMessage: lastUserMsg,
    });

    // 1. Fetch current conversation state. Preferred path resolves by
    // conversationId; the legacy path resolves by callId exactly as before.
    let stateContextStr = '';
    try {
      const state = identity.kind === 'conversation'
        ? await getStateByConversationId(identity.conversationId as string)
        : identity.kind === 'call'
          ? await getStateByCallId(identity.callId as string)
          : null;
      if (state) {
          stateContextStr = `\n\nCURRENT CONVERSATION STATE:\n` +
            `- Customer Name: ${state.customer_name || 'Not provided'}\n` +
            `- Pickup Location: ${state.pickup_location || 'Not provided'}\n` +
            `- Destination: ${state.destination || 'Not provided'}\n` +
            `- Vehicle Type: ${state.vehicle_type || 'Not provided'}\n` +
            `- Cargo Type: ${state.cargo_type || 'Not provided'}\n` +
            `- Cargo Weight: ${state.cargo_weight !== null && state.cargo_weight !== undefined ? state.cargo_weight + ' kg' : 'Not provided'}\n` +
            `- Required Date: ${state.required_date || 'Not provided'}\n` +
            `- Budget: ${state.budget !== null && state.budget !== undefined ? 'INR ' + state.budget : 'Not provided'}\n` +
            `- Urgency: ${state.urgency || 'Not provided'}\n` +
            `- Additional Requirements: ${state.additional_requirements || 'None'}`;
        }
      } catch (err: any) {
        logger.error('Error fetching conversation state in AgentOrchestrator', { error: err.message });
      }

    // 2. Selective RAG Knowledge Retrieval (Phase 6 integration)
    let ragContextStr = '';
    if (isKnowledgeSearchRequired(lastUserMsg)) {
      try {
        logger.info('Factual knowledge search triggered in AgentOrchestrator', { query: lastUserMsg });
        const ragResult = await searchKnowledge({ query: lastUserMsg, topK: 3, similarityThreshold: 0.3 });
        if (ragResult.results && ragResult.results.length > 0) {
          ragContextStr = `\n\nRETRIEVED KNOWLEDGE BASE CONTEXT:\n` +
            ragResult.results.map((r, i) => `[Document ${i + 1}: ${r.title}]\n${r.chunkText}`).join('\n\n');
        } else {
          ragContextStr = `\n\nRETRIEVED KNOWLEDGE BASE CONTEXT:\nNo relevant company policy document found matching the query.`;
        }
      } catch (err: any) {
        logger.error('Error performing RAG search in AgentOrchestrator', { error: err.message });
      }
    }

    // 3. Assemble System Prompt (operator configuration is read live so
    // saved AI Agent page edits actually affect behavior)
    const fullSystemPrompt = `${agentConfig.systemPrompt}

OPERATOR CONFIGURATION (live):
${getAgentPromptContext()}

SUPPORTED LANGUAGES & RULES:
- Languages: English, Hindi, Tamil.
- Naturally code-switch if customer speaks Hindi or Tamil.
- Focus strictly on understanding & collecting logistics requirements.${stateContextStr}${ragContextStr}`;

    // Filter incoming messages to exclude any existing system message and prepend assembled system prompt
    const cleanHistory = messages.filter(m => m.role !== 'system');
    const fullMessages: LlmMessage[] = [
      { role: 'system', content: fullSystemPrompt },
      ...cleanHistory
    ];

    // 4. Invoke LLM Provider
    const provider = getLlmProvider();
    logger.info(`Using LLM Provider: ${provider.getProviderName()}`);

    if (stream && provider.generateStream) {
      return provider.generateStream(fullMessages, tools, onStreamChunk);
    }
    return provider.generateResponse(fullMessages, tools);
  }
}

export const orchestrator = new AgentOrchestrator();
