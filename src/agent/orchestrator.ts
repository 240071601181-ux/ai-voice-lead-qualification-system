import { agentConfig } from './config';
import { getAgentPromptContext } from '../services/agentConfigService';
import { getLlmProvider, LlmMessage, LlmResponse, LlmToolDefinition } from './llm';
import { getStateByCallId, getStateByConversationId } from '../services/conversationStateService';
import { formatStateDate } from './textStateExtraction';
import {
  AgentContext,
  ConversationChannel,
  resolveAgentIdentity,
} from './conversation';
import { searchKnowledge } from '../services/knowledgeService';
import { getChatMaxContextMessages, getChatMaxToolRounds } from '../config';
import {
  dispatchConversationTool,
  extractJsonToolCallsFromContent,
  getTextToolDefinitions,
  isJsonToolCallContent,
  looksLikeJsonToolCall,
  TrustedConversationContext,
} from './conversationTools';
import { logger } from '../utils/logger';

/** Selective-RAG retrieval defaults (Phase 4: preserved from Phase 1/3). */
export const RAG_TOP_K = 3;
export const RAG_SIMILARITY_THRESHOLD = 0.3;

/**
 * Text-turn guidance layered on top of the shared system prompt (Phase 4).
 * The core prompt in agent/config.ts is untouched; this additive block makes
 * the shared behavior explicit for multi-turn text: use known slots, don't
 * re-ask, stay in character, never claim an action succeeded without a tool.
 */
export const TEXT_TURN_GUIDANCE = [
  'TEXT CONVERSATION RULES:',
  '- You are a logistics sales assistant having a multi-turn text conversation.',
  '- Collect missing qualification information naturally, one or two questions at a time.',
  '- Do NOT repeatedly ask for details already listed under CURRENT CONVERSATION STATE.',
  '- Use RETRIEVED KNOWLEDGE BASE CONTEXT when relevant; otherwise rely on the conversation.',
  '- Maintain conversational continuity with the recent history (names, places, prior answers).',
  '- Reply in the customer\'s language (English, Hindi, Tamil) and code-switch naturally.',
  '- Never claim a booking, payment, or update succeeded unless a tool result confirms it.',
  '- To save details, use the provided tools via native tool calls. Never write JSON tool calls as text; always reply to the customer in natural language.',
  '- Meetings: only offer to schedule after the user gives a concrete date/time (ask first); check availability before booking; never infer meeting time from required_date.',
].join('\n');

/**
 * Continuation-loop failure message (user-safe, persisted only when the
 * controller cannot compose the state-grounded informative fallback).
 */
export const TOOL_LOOP_CONTINUATION_ERROR =
  'I ran into a problem finishing that update. Please try again.';

/** Short conversational messages that never need knowledge retrieval. */
const TRIVIAL_MESSAGES = new Set([
  'hi', 'hello', 'hey', 'ok', 'okay', 'thanks', 'thank you', 'bye',
  'yes', 'no', 'sure', 'great', 'fine', 'good morning', 'good afternoon', 'good evening',
]);

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
 * Trivial conversational messages (hi/okay/thanks) never trigger retrieval.
 */
export const isKnowledgeSearchRequired = (text: string): boolean => {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim().toLowerCase();
  if (trimmed.length === 0) return false;
  if (TRIVIAL_MESSAGES.has(trimmed)) return false;
  if (trimmed.length <= 3) return false;
  const lower = trimmed;
  const keywords = [
    // Preserved Phase 1/3 decision vocabulary (do not remove).
    'policy', 'sop', 'standard', 'rule', 'rate', 'guideline', 'restriction',
    'term', 'condition', 'timing', 'guarantee', 'cancellation', 'procedure',
    'hours', 'delivery time', 'tracking', 'cargo rule', 'what is the policy',
    // Phase 4 extensions: fleet/services + operating-hours questions.
    'vehicle', 'vehicles', 'fleet', 'truck', 'container', 'tempo', 'lorry', 'trailer',
    'service', 'services', 'provide', 'offer', 'operate', 'operating', 'operation',
    'sunday', 'monday', 'holiday', 'working day', 'open on', 'working hours',
    'shipment', 'delivery', 'cargo', 'price', 'pricing', 'cost', 'charge', 'fee', 'quote',
    'coverage', 'cities', 'support',
  ];
  return keywords.some(kw => lower.includes(kw));
};

/**
 * Bound the history window forwarded to the LLM (Phase 4 token safety).
 * Pure slice of the already-chronological history; persistence is untouched.
 */
export const limitContextMessages = <T>(messages: T[], max?: number): T[] => {
  const cap = max ?? getChatMaxContextMessages();
  if (!Array.isArray(messages) || messages.length <= cap) return messages;
  return messages.slice(messages.length - cap);
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
    const messagePreview = lastUserMsg.slice(0, 120);

    logger.info('AgentOrchestrator processing turn', {
      conversationId: identity.conversationId ?? null,
      callId: identity.callId ?? null,
      channel: effectiveContext.channel ?? null,
      leadId: effectiveContext.leadId ?? null,
      userMessageLength: lastUserMsg.length,
      userMessagePreview: messagePreview,
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
            `- Required Date: ${formatStateDate((state as unknown as Record<string, unknown>).required_date) || 'Not provided'}\n` +
            `- Budget: ${state.budget !== null && state.budget !== undefined ? 'INR ' + state.budget : 'Not provided'}\n` +
            `- Urgency: ${state.urgency || 'Not provided'}\n` +
            `- Additional Requirements: ${state.additional_requirements || 'None'}`;
        }
      } catch (err: any) {
        logger.error('Error fetching conversation state in AgentOrchestrator', { error: err.message });
      }

    // 2. Selective RAG Knowledge Retrieval (preserved topK/threshold).
    // Skipped for trivial conversational messages; failures never break chat.
    let ragContextStr = '';
    let ragUsed = false;
    let ragChunkCount = 0;
    if (isKnowledgeSearchRequired(lastUserMsg)) {
      try {
        logger.info('Factual knowledge search triggered in AgentOrchestrator', {
          conversationId: identity.conversationId ?? null,
          callId: identity.callId ?? null,
          queryLength: lastUserMsg.length,
          queryPreview: messagePreview,
        });
        const ragResult = await searchKnowledge({ query: lastUserMsg, topK: RAG_TOP_K, similarityThreshold: RAG_SIMILARITY_THRESHOLD });
        ragUsed = true;
        ragChunkCount = ragResult.results ? ragResult.results.length : 0;
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

    // 3. Assemble System Prompt deterministically (Phase 4 order):
    // business instructions -> operator config -> text-turn guidance ->
    // current structured state -> retrieved knowledge -> history -> current turn.
    // Operator configuration is read live so saved AI Agent page edits
    // actually affect behavior. Core prompt in agent/config.ts is unchanged.
    const fullSystemPrompt = `${agentConfig.systemPrompt}

OPERATOR CONFIGURATION (live):
${getAgentPromptContext()}

${TEXT_TURN_GUIDANCE}

SUPPORTED LANGUAGES & RULES:
- Languages: English, Hindi, Tamil.
- Naturally code-switch if customer speaks Hindi or Tamil.
- Focus strictly on understanding & collecting logistics requirements.${stateContextStr}${ragContextStr}`;

    // Filter incoming messages to exclude any existing system message and
    // prepend the single assembled system prompt (never duplicated).
    // Only role + content cross into the LLM: DB metadata (ids, timestamps,
    // tool_calls payloads stored separately) is never forwarded, and no
    // internal tool metadata is injected as user text.
    // The history window is bounded by CHAT_MAX_CONTEXT_MESSAGES; older
    // persisted rows are kept in the database and simply not forwarded.
    const cleanHistory = limitContextMessages(
      messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }))
    );
    const fullMessages: LlmMessage[] = [
      { role: 'system', content: fullSystemPrompt },
      ...cleanHistory
    ];

    // 4. Invoke LLM Provider. Exceptions propagate so the controller can
    // return a safe API error WITHOUT persisting a fake assistant message.
    const provider = getLlmProvider();
    const isTextTurn = identity.kind === 'conversation';
    // Text turns advertise the conversation-anchored tools when the caller
    // did not supply its own definitions. The legacy Vapi path keeps its
    // caller-supplied tools untouched (Vapi executes those server-side).
    const activeTools = tools ?? (isTextTurn ? getTextToolDefinitions() : undefined);
    logger.info('Using LLM Provider', {
      provider: provider.getProviderName(),
      conversationId: identity.conversationId ?? null,
      callId: identity.callId ?? null,
      ragUsed,
      ragChunkCount,
      contextMessages: fullMessages.length,
    });

    const invokeFirst = async (): Promise<LlmResponse> => {
      if (stream && provider.generateStream) {
        return provider.generateStream(fullMessages, activeTools, onStreamChunk);
      }
      return provider.generateResponse(fullMessages, activeTools);
    };

    try {
      const first = await invokeFirst();
      // Strict JSON-text fallback (text turns only): some local models emit
      // the tool call as assistant content instead of structured tool_calls.
      // Convert it into the standard representation so the existing tool
      // loop executes it instead of leaking raw JSON to the customer.
      // Legacy voice/Vapi turns are untouched (returned as-is below).
      if (isTextTurn && (!first.toolCalls || first.toolCalls.length === 0)) {
        const fallback = extractJsonToolCallsFromContent(first.content);
        if (fallback) {
          logger.info('Text turn JSON tool-call content recognized; routing to tool loop', {
            conversationId: identity.conversationId ?? null,
            tool: fallback[0].function.name,
          });
          first.toolCalls = fallback;
        } else if (looksLikeJsonToolCall(first.content)) {
          // Malformed/truncated tool-shaped content: arguments are unknowable
          // so nothing may execute, and raw machinery must never render.
          // Empty content lets the controller persist its safe placeholder.
          logger.warn('Text turn emitted malformed tool-call JSON; suppressing (never executed, never rendered)', {
            conversationId: identity.conversationId ?? null,
          });
          first.content = '';
        }
      }
      logger.info('AgentOrchestrator turn completed', {
        conversationId: identity.conversationId ?? null,
        callId: identity.callId ?? null,
        leadId: effectiveContext.leadId ?? null,
        ragUsed,
        ragChunkCount,
        llmSuccess: true,
      });
      // Legacy voice/Vapi turns return tool calls to the caller for
      // server-side execution — never auto-execute here.
      if (!isTextTurn || !first.toolCalls || first.toolCalls.length === 0) {
        return first;
      }
      // Phase 5: bounded conversation-anchored tool loop (text only).
      return await this.runTextToolLoop(provider, fullMessages, first, activeTools, {
        conversationId: identity.conversationId as string,
        leadId: effectiveContext.leadId ?? null,
      });
    } catch (err: any) {
      logger.error('AgentOrchestrator LLM failure (no assistant message persisted)', {
        conversationId: identity.conversationId ?? null,
        callId: identity.callId ?? null,
        leadId: effectiveContext.leadId ?? null,
        ragUsed,
        ragChunkCount,
        error: err?.message,
      });
      throw err;
    }
  }

  /**
   * Execute LLM-requested tools against the trusted conversation context and
   * continue the LLM until a final response (or the round budget runs out).
   * Bounded by CHAT_MAX_TOOL_ROUNDS; unknown tools and invalid arguments
   * become safe tool errors, never crashes; repeated failure stops safely.
   */
  private async runTextToolLoop(
    provider: ReturnType<typeof getLlmProvider>,
    seedMessages: LlmMessage[],
    first: LlmResponse,
    tools: LlmToolDefinition[] | undefined,
    ctx: TrustedConversationContext
  ): Promise<LlmResponse> {
    const maxRounds = getChatMaxToolRounds();
    const working: LlmMessage[] = [...seedMessages];
    let current = first;
    let rounds = 0;

    while (current.toolCalls && current.toolCalls.length > 0 && rounds < maxRounds) {
      rounds += 1;
      const pending = current.toolCalls;
      logger.info('Text tool round started', {
        conversationId: ctx.conversationId,
        leadId: ctx.leadId ?? null,
        round: rounds,
        maxRounds,
        toolCount: pending.length,
      });

      const followups: LlmMessage[] = [
        { role: 'assistant', content: current.content || '', tool_calls: pending as unknown as any[] },
      ];
      for (const call of pending) {
        // The raw arguments string goes straight to the dispatcher, which
        // parses, validates, and injects the trusted context. LLM-supplied
        // identities inside are ignored — ctx always wins.
        const outcome = await dispatchConversationTool(ctx, call.function?.name, call.function?.arguments);
        current.executedTools = [...(current.executedTools ?? []), { name: outcome.name, success: outcome.success }];
        followups.push({ role: 'tool', content: outcome.resultText, tool_call_id: call.id });
      }
      working.push(...followups);

      try {
        const next = await provider.generateResponse(working, tools);
        // Carry the audit trail across continuations.
        next.executedTools = current.executedTools;
        // Continuations may also emit JSON-text tool calls; convert them so
        // multi-round tool use keeps working instead of leaking JSON.
        if (!next.toolCalls || next.toolCalls.length === 0) {
          const fallback = extractJsonToolCallsFromContent(next.content);
          if (fallback) {
            logger.info('Tool-loop continuation JSON tool-call recognized', {
              conversationId: ctx.conversationId,
              leadId: ctx.leadId ?? null,
              round: rounds,
              tool: fallback[0].function.name,
            });
            next.toolCalls = fallback;
          }
        }
        logger.info('Text tool-loop continuation LLM call finished', {
          conversationId: ctx.conversationId,
          leadId: ctx.leadId ?? null,
          round: rounds,
          hasContent: (next.content || '').trim().length > 0,
          hasToolCalls: (next.toolCalls ?? []).length,
        });
        current = next;
      } catch (err: any) {
        logger.error('Text tool-loop LLM continuation failed; returning safe partial response', {
          conversationId: ctx.conversationId,
          leadId: ctx.leadId ?? null,
          round: rounds,
          error: err?.message,
        });
        current = {
          content: current.content || TOOL_LOOP_CONTINUATION_ERROR,
          finishReason: 'stop',
          executedTools: current.executedTools,
        };
        break;
      }
    }

    if (current.toolCalls && current.toolCalls.length > 0 && rounds >= maxRounds) {
      // Budget exhausted with calls still pending: drop the unexecuted calls
      // so nothing downstream mistakes them for completed work.
      logger.warn('Text tool loop reached max rounds; dropping pending tool calls', {
        conversationId: ctx.conversationId,
        leadId: ctx.leadId ?? null,
        maxRounds,
        pendingTools: current.toolCalls.length,
      });
      current = { ...current, toolCalls: undefined };
      if (!current.content || current.content.trim().length === 0) {
        current = {
          ...current,
          content: 'I could not finish all the updates in time. Please try again.',
        };
      }
    }

    // Final leak guard: raw tool-call JSON must never reach the customer
    // or the transcript. If the model never produced natural language —
    // including malformed/truncated tool-shaped content — blank the content
    // so the controller composes the state-grounded informative fallback
    // (single source of customer-facing fallback text).
    if (
      !current.content ||
      current.content.trim().length === 0 ||
      isJsonToolCallContent(current.content) ||
      looksLikeJsonToolCall(current.content)
    ) {
      logger.warn('Text tool loop ended without usable content; controller will compose fallback', {
        conversationId: ctx.conversationId,
        leadId: ctx.leadId ?? null,
        rounds,
      });
      current = { ...current, toolCalls: undefined, content: '' };
    }

    logger.info('Text tool loop finished', {
      conversationId: ctx.conversationId,
      leadId: ctx.leadId ?? null,
      rounds,
      executedTools: (current.executedTools ?? []).length,
    });
    return current;
  }
}

export const orchestrator = new AgentOrchestrator();
