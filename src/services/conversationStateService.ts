import { findStateByCallId, createState, updateState as repoUpdateState, findStateById } from '../repositories/conversationStateRepository';
import { ConversationState } from '../models/ConversationState';
import { logger } from '../utils/logger';

/**
 * Initialize conversation state for a call.
 * If a state already exists for the call, returns existing state (idempotent).
 * leadId may be null – we allow that per requirement.
 */
export const initializeState = async (callId: string, leadId: string | null = null): Promise<ConversationState> => {
  const existing = await findStateByCallId(callId);
  if (existing) {
    logger.info('Conversation state already exists for call', { callId });
    return existing;
  }
  const state = await createState({ call_id: callId, lead_id: leadId });
  logger.info('Conversation state initialized', { callId, leadId });
  return state;
};

/**
 * Get conversation state by internal callId (legacy voice path).
 */
export const getStateByCallId = async (callId: string): Promise<ConversationState | null> => {
  return findStateByCallId(callId);
};

export interface ConversationStateLookupOptions {
  /**
   * Linked legacy call id (e.g. a `legacy_voice` conversation bridged to a
   * Vapi call). Used only until the Phase 2 conversation-state table exists.
   */
  linkedCallId?: string | null;
}

/**
 * Get conversation state by conversationId (Phase 1 abstraction).
 *
 * No conversations/state table exists yet, so unlinked conversationIds
 * resolve to null and the orchestrator proceeds stateless. Conversations
 * explicitly linked to a legacy call fall back to the call-anchored lookup
 * so the voice flow keeps working. Phase 2 backs this with a real table
 * without changing the signature.
 */
export const getStateByConversationId = async (
  conversationId: string,
  options: ConversationStateLookupOptions = {}
): Promise<ConversationState | null> => {
  if (options.linkedCallId) {
    logger.info('Resolving conversation state via linked legacy call', { conversationId });
    return findStateByCallId(options.linkedCallId);
  }
  logger.info('No conversation-state store yet for conversationId (Phase 2)', { conversationId });
  return null;
};

/**
 * Update conversation state fields for a given call.
 */
export const updateState = async (callId: string, updates: Partial<ConversationState>): Promise<ConversationState | null> => {
  const updated = await repoUpdateState(callId, updates);
  logger.info('Conversation state updated', { callId, updates });
  return updated;
};
