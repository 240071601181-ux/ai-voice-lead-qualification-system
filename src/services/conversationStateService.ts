import { findStateByCallId, createState, updateState as repoUpdateState, findStateById } from '../repositories/conversationStateRepository';
import { findConversationStateByConversationId, createConversationState, updateConversationStateRecord } from '../repositories/conversationStatesRepository';
import { ConversationState } from '../models/ConversationState';
import { ConversationStateRecord } from '../models/Conversation';
import {
  TextStateUpdate,
  extractStateFromMessage,
  mergeTextConversationState,
  validateTextStateUpdate,
} from '../agent/textStateExtraction';
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

export interface TextStateExtractionResult {
  /** Merged record after persistence (null when nothing changed/created). */
  state: ConversationStateRecord | null;
  /** Whether any slot actually changed in this turn. */
  stateChanged: boolean;
  /** Number of slots extracted from this message. */
  extractedFields: number;
}

/**
 * Phase 4 — text-safe state extraction path (conversationId-anchored).
 *
 * 1. Extracts a candidate partial update from the latest user message
 *    (deterministic heuristic; LLM-JSON objects can be passed via
 *    `llmExtracted` and go through the same validator).
 * 2. Validates every value; invalid/unknown values are dropped.
 * 3. Merges deterministically over the existing record (unknown values
 *    never erase known fields) and persists via parameterized repository
 *    calls only — this function never builds SQL itself.
 * 4. Failures never throw to the caller: extraction must not break chat.
 *
 * The legacy call-anchored path above is untouched.
 */
export const extractAndPersistTextState = async (
  conversationId: string,
  userMessage: string,
  options: { leadId?: string | null; llmExtracted?: unknown } = {}
): Promise<TextStateExtractionResult> => {
  const empty: TextStateExtractionResult = { state: null, stateChanged: false, extractedFields: 0 };
  try {
    if (!conversationId || typeof conversationId !== 'string') return empty;
    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      return empty;
    }

    const heuristic = extractStateFromMessage(userMessage);
    let candidate: TextStateUpdate = { ...heuristic };
    if (options.llmExtracted !== undefined) {
      // LLM JSON is never trusted directly — same validator applies.
      const validated = validateTextStateUpdate(options.llmExtracted);
      if (!validated.valid) {
        logger.warn('Text state LLM extraction contained invalid fields; ignored', {
          conversationId,
          errors: validated.errors,
        });
      }
      candidate = mergeTextConversationState(heuristic, validated.sanitized);
    }

    const fields = Object.keys(candidate);
    if (fields.length === 0) return empty;

    const existing = await findConversationStateByConversationId(conversationId);
    const merged = mergeTextConversationState(existing, candidate);

    // Detect real change vs. no-op re-extraction of identical values.
    let changed = false;
    if (!existing) {
      changed = true;
    } else {
      const existingRec = existing as unknown as Record<string, unknown>;
      const mergedRec = merged as unknown as Record<string, unknown>;
      for (const key of Object.keys(candidate)) {
        if (existingRec[key] !== mergedRec[key]) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) {
      return { state: existing, stateChanged: false, extractedFields: fields.length };
    }

    if (!existing) {
      await createConversationState({
        conversation_id: conversationId,
        lead_id: options.leadId ?? null,
      });
    }
    // Only validated, whitelisted fields reach the repository (parameterized).
    const persisted = await updateConversationStateRecord(conversationId, candidate);
    return { state: persisted, stateChanged: true, extractedFields: fields.length };
  } catch (err: any) {
    logger.error('Text state extraction failed safely (chat continues)', {
      conversationId,
      error: err?.message,
    });
    return empty;
  }
};
