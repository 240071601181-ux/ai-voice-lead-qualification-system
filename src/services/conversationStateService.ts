import { findStateByCallId, createState, updateState as repoUpdateState, findStateById } from '../repositories/conversationStateRepository';
import { findConversationStateByConversationId } from '../repositories/conversationStatesRepository';
import { ConversationState } from '../models/ConversationState';
import { ConversationStateRecord } from '../models/Conversation';
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
 * Get conversation state by conversationId (Phase 2: persistent lookup).
 *
 * Resolution order:
 *   1. conversation_states table (future source of truth for text chats)
 *   2. explicitly linked legacy call via the old call-anchored lookup
 *      (temporary bridge for `legacy_voice` conversations)
 *   3. null when neither exists (orchestrator proceeds stateless)
 */
export const getStateByConversationId = async (
  conversationId: string,
  options: ConversationStateLookupOptions = {}
): Promise<ConversationState | ConversationStateRecord | null> => {
  const record = await findConversationStateByConversationId(conversationId);
  if (record) {
    return record;
  }
  if (options.linkedCallId) {
    logger.info('Resolving conversation state via linked legacy call', { conversationId });
    return findStateByCallId(options.linkedCallId);
  }
  logger.info('No conversation state found for conversationId', { conversationId });
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
