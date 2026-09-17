/**
 * Text conversation domain model (Phase 1).
 *
 * Introduces `conversationId` as the preferred identity for AI conversations:
 *   Lead → Conversation → Messages → AgentOrchestrator
 *
 * `callId` remains supported as legacy compatibility infrastructure for the
 * existing voice/Vapi flow. Nothing here touches the database yet — the
 * conversations/messages tables land in Phase 2. This module is intentionally
 * transport-independent: no Vapi/voice/call naming for new abstractions.
 */

export type ConversationChannel = 'web' | 'whatsapp' | 'legacy_voice';

export type ConversationStatus = 'active' | 'completed' | 'abandoned';

export const CONVERSATION_CHANNELS: ConversationChannel[] = ['web', 'whatsapp', 'legacy_voice'];

export const CONVERSATION_STATUSES: ConversationStatus[] = ['active', 'completed', 'abandoned'];

/**
 * Backend conversation domain object (no persistence yet — Phase 2).
 */
export interface Conversation {
  id: string; // UUID, primary identity for AI conversations
  leadId?: string | null;
  channel: ConversationChannel;
  status: ConversationStatus;
  startedAt?: string | null; // ISO timestamp
  endedAt?: string | null; // ISO timestamp
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/**
 * Transport-independent context for a single agent turn.
 * `conversationId` is preferred; `callId` is legacy voice compatibility.
 */
export interface AgentContext {
  conversationId?: string | null;
  callId?: string | null;
  leadId?: string | null;
  channel?: ConversationChannel | null;
}

export type AgentIdentityKind = 'conversation' | 'call' | 'none';

export interface AgentIdentity {
  kind: AgentIdentityKind;
  conversationId?: string;
  callId?: string;
}

/**
 * Per-channel metadata. The agent itself stays transport-independent;
 * channels only describe where the conversation happens. `legacy_voice`
 * marks the temporary compatibility path back to call-anchored state.
 */
export const CHANNEL_METADATA: Record<ConversationChannel, { label: string; isLegacy: boolean }> = {
  web: { label: 'Web chat', isLegacy: false },
  whatsapp: { label: 'WhatsApp messaging', isLegacy: false },
  legacy_voice: { label: 'Legacy voice call (Vapi compatibility)', isLegacy: true },
};

export const isConversationChannel = (value: unknown): value is ConversationChannel =>
  typeof value === 'string' && (CONVERSATION_CHANNELS as string[]).includes(value);

export const isConversationStatus = (value: unknown): value is ConversationStatus =>
  typeof value === 'string' && (CONVERSATION_STATUSES as string[]).includes(value);

/**
 * Validate an agent context. Follows the repo convention of returning a
 * string[] of errors (see agent/tools.ts validators).
 * At least one of conversationId/callId is required; channel, when present,
 * must be a known value.
 */
export const validateAgentContext = (context: any): string[] => {
  const errors: string[] = [];
  if (!context || typeof context !== 'object') {
    errors.push('Context must be an object');
    return errors;
  }
  const hasConversation = typeof context.conversationId === 'string' && context.conversationId.length > 0;
  const hasCall = typeof context.callId === 'string' && context.callId.length > 0;
  if (!hasConversation && !hasCall) {
    errors.push('Either conversationId or callId is required');
  }
  if (context.conversationId !== undefined && context.conversationId !== null && typeof context.conversationId !== 'string') {
    errors.push('conversationId must be a string');
  }
  if (context.callId !== undefined && context.callId !== null && typeof context.callId !== 'string') {
    errors.push('callId must be a string');
  }
  if (context.leadId !== undefined && context.leadId !== null && typeof context.leadId !== 'string') {
    errors.push('leadId must be a string');
  }
  if (context.channel !== undefined && context.channel !== null && !isConversationChannel(context.channel)) {
    errors.push(`channel must be one of: ${CONVERSATION_CHANNELS.join(', ')}`);
  }
  return errors;
};

/**
 * Resolve which identity drives a turn. `conversationId` always wins when
 * present; `callId` is the legacy fallback. Returns kind 'none' when neither
 * is provided (caller decides how to handle — orchestrator proceeds
 * stateless in that case, matching pre-Phase-1 behavior for missing callId).
 */
export const resolveAgentIdentity = (context: AgentContext): AgentIdentity => {
  if (context && typeof context.conversationId === 'string' && context.conversationId.length > 0) {
    return { kind: 'conversation', conversationId: context.conversationId };
  }
  if (context && typeof context.callId === 'string' && context.callId.length > 0) {
    return { kind: 'call', callId: context.callId };
  }
  return { kind: 'none' };
};
