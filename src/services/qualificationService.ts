import { ConversationState } from '../models/ConversationState';
import { ConversationStateRecord } from '../models/Conversation';
import { BookingIntent, Qualification, QualificationDetails, QualificationTier } from '../models/Qualification';
import { findCallById } from '../repositories/callRepository';
import {
  findQualificationByConversationId,
  upsertConversationQualification,
  upsertQualification,
} from '../repositories/qualificationRepository';
import { findConversationById } from '../repositories/conversationRepository';
import { findConversationStateByConversationId } from '../repositories/conversationStatesRepository';
import { getStateByCallId } from './conversationStateService';
import { logger } from '../utils/logger';

const DAY_MS = 24 * 60 * 60 * 1000;

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

const validPositiveNumber = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value === 'string' && value.trim().length > 0) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0;
  }
  return false;
};

// pg returns DATE columns as JS Date objects and NUMERIC columns as strings.
// Normalize to YYYY-MM-DD without inferring missing values.
const normalizeDateOnly = (value: unknown): string | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim().slice(0, 10);
  }
  return null;
};

const scoreTier = (score: number): QualificationTier => {
  if (score >= 70) return 'HOT';
  if (score >= 40) return 'WARM';
  return 'COLD';
};

const urgencyCriterion = (state: ConversationState, qualifiedAt: Date) => {
  const normalized = normalizeDateOnly(state.required_date);
  if (!normalized) {
    return { points: 0, qualified: false, reason: 'required_date missing' };
  }
  const requiredDate = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(requiredDate.getTime())) {
    return { points: 0, qualified: false, reason: 'required_date invalid' };
  }
  const daysUntilRequired = Math.floor((requiredDate.getTime() - Date.UTC(
    qualifiedAt.getUTCFullYear(), qualifiedAt.getUTCMonth(), qualifiedAt.getUTCDate()
  )) / DAY_MS);
  if (daysUntilRequired >= 0 && daysUntilRequired <= 3) {
    return { points: 30, qualified: true, reason: 'required_date is within three days' };
  }
  return { points: 0, qualified: false, reason: 'required_date is more than three days away or past' };
};

export const calculateQualification = (state: ConversationState, qualifiedAt = new Date()): {
  score: number;
  tier: QualificationTier;
  details: QualificationDetails;
} => {
  const urgency = urgencyCriterion(state, qualifiedAt);
  const budget = validPositiveNumber(state.budget)
    ? { points: 20, qualified: true, reason: 'budget is disclosed and positive' }
    : { points: 0, qualified: false, reason: 'budget missing or not positive' };
  const route = hasText(state.pickup_location) && hasText(state.destination)
    ? { points: 20, qualified: true, reason: 'pickup and destination are present' }
    : { points: 0, qualified: false, reason: 'pickup or destination missing' };
  const vehicle = hasText(state.vehicle_type)
    ? { points: 10, qualified: true, reason: 'vehicle_type is present' }
    : { points: 0, qualified: false, reason: 'vehicle_type missing' };
  const cargo = validPositiveNumber(state.cargo_weight) || hasText(state.cargo_dimensions)
    ? { points: 10, qualified: true, reason: 'cargo weight or dimensions are present' }
    : { points: 0, qualified: false, reason: 'cargo weight and dimensions missing' };
  const bookingIntent: BookingIntent = state.booking_intent === 'explicit'
    ? 'explicit'
    : state.booking_intent === 'not_explicit' ? 'not_explicit' : 'unknown';
  const booking = bookingIntent === 'explicit'
    ? { points: 10, qualified: true, reason: 'explicit booking intent recorded' }
    : { points: 0, qualified: false, reason: 'explicit booking intent not recorded' };

  const score = urgency.points + budget.points + route.points + vehicle.points + cargo.points + booking.points;
  const details: QualificationDetails = {
    criteria: {
      urgency,
      budget,
      route,
      vehicle,
      cargo,
      bookingIntent: booking
    },
    totalScore: score,
    qualifiedAt: qualifiedAt.toISOString()
  };
  return { score, tier: scoreTier(score), details };
};

export const qualifyCall = async (callId: string, qualifiedAt = new Date()): Promise<Qualification> => {
  const state = await getStateByCallId(callId);
  if (!state) {
    throw new Error(`Conversation state for call ${callId} not found`);
  }
  const call = await findCallById(callId);
  const result = calculateQualification(state, qualifiedAt);
  const qualification = await upsertQualification({
    call_id: callId,
    lead_id: state.lead_id ?? call?.lead_id ?? null,
    score: result.score,
    tier: result.tier,
    details: result.details,
    qualified_at: qualifiedAt.toISOString()
  });
  logger.info('Lead qualification completed', { callId, score: result.score, tier: result.tier });
  return qualification;
};

const qualificationError = (status: number, message: string): any => {
  const err: any = new Error(message);
  err.status = status;
  return err;
};

export interface QualifyConversationOptions {
  /**
   * Preserved only for bridged legacy conversations that already have a
   * call row. Never invented for text: web/WhatsApp rows persist with
   * call_id NULL.
   */
  callId?: string | null;
}

/**
 * Phase 6 — conversation-based qualification.
 *
 * A. fetch conversation (trusted record, not caller input)
 * B. resolve trusted leadId from the conversation (never from arguments)
 * C. fetch conversation_states (the scoring source for text)
 * D. calculate via the existing deterministic scorer (unchanged weights)
 * E. idempotent persist anchored on conversation_id (single row per
 *    conversation; re-qualification updates in place)
 * F. return the persisted result
 *
 * Rejects (with err.status for the controller): missing conversation (404),
 * missing lead (422), missing state row (422). The legacy qualifyCall()
 * above is untouched.
 */
export const qualifyConversation = async (
  conversationId: string,
  qualifiedAt = new Date(),
  options: QualifyConversationOptions = {}
): Promise<Qualification> => {
  if (!conversationId || typeof conversationId !== 'string') {
    throw qualificationError(400, 'conversationId is required and must be a string');
  }
  const conversation = await findConversationById(conversationId);
  if (!conversation) {
    throw qualificationError(404, 'Conversation not found');
  }
  const leadId = conversation.lead_id ?? null;
  if (!leadId) {
    throw qualificationError(422, 'Conversation is not linked to a lead and cannot be qualified');
  }
  const state = await findConversationStateByConversationId(conversationId);
  if (!state) {
    throw qualificationError(422, 'No conversation state recorded for this conversation yet');
  }
  // Same slot shape as the legacy table; the scorer itself is reused as-is.
  const result = calculateQualification(state as unknown as ConversationState, qualifiedAt);
  const qualification = await upsertConversationQualification({
    conversation_id: conversationId,
    call_id: options.callId ?? null,
    lead_id: leadId,
    score: result.score,
    tier: result.tier,
    details: result.details,
    qualified_at: qualifiedAt.toISOString(),
  });
  logger.info('Conversation qualification completed', {
    conversationId,
    leadId,
    score: result.score,
    tier: result.tier,
  });
  return qualification;
};

/**
 * Deterministic auto-qualification gate (least disruptive rule):
 * - explicit booking intent → qualify immediately, OR
 * - route (pickup + destination) known AND ≥2 supporting criteria
 *   (budget / vehicle / cargo / urgency) qualified, OR
 * - otherwise → not yet (no premature qualification on thin state).
 *
 * Evaluated through the existing scorer's own criteria so the gate can
 * never drift from the scoring rules.
 */
export const isQualificationReady = (
  state: ConversationState | ConversationStateRecord | null | undefined,
  qualifiedAt = new Date()
): boolean => {
  if (!state) return false;
  const probe = calculateQualification(state as unknown as ConversationState, qualifiedAt);
  const criteria = probe.details.criteria;
  if (criteria.bookingIntent.qualified) return true;
  if (!criteria.route.qualified) return false;
  const supporting = [criteria.budget, criteria.vehicle, criteria.cargo, criteria.urgency].filter(
    (c) => c.qualified
  ).length;
  return supporting >= 2;
};

export type AutoQualifyReason = 'state_changed' | 'tool_update' | 'completed' | 'manual';

/**
 * Controlled trigger: recalculates only when the gate passes. Persistence
 * only — no CRM/WhatsApp/n8n/calendar fan-out in this phase, so no
 * message → qualification → integration → message loop is possible.
 * Never throws: auto-qualification must not break the chat turn.
 */
export const maybeAutoQualifyConversation = async (
  conversationId: string,
  reason: AutoQualifyReason = 'state_changed',
  qualifiedAt = new Date()
): Promise<Qualification | null> => {
  try {
    if (!conversationId || typeof conversationId !== 'string') return null;
    const conversation = await findConversationById(conversationId);
    if (!conversation || !conversation.lead_id) return null;
    const state = await findConversationStateByConversationId(conversationId);
    if (!isQualificationReady(state, qualifiedAt)) return null;
    const qualification = await qualifyConversation(conversationId, qualifiedAt);
    logger.info('Conversation auto-qualified', {
      conversationId,
      leadId: conversation.lead_id,
      triggeredBy: reason,
      score: qualification.score,
      tier: qualification.tier,
    });
    return qualification;
  } catch (err: any) {
    logger.error('Conversation auto-qualification skipped safely', {
      conversationId,
      error: err?.message,
    });
    return null;
  }
};

export const getQualificationByConversationId = async (
  conversationId: string
): Promise<Qualification | null> => {
  return findQualificationByConversationId(conversationId);
};