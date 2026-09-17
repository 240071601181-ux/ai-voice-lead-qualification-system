/**
 * Phase 9 – pure CRM field mapping.
 *
 * Maps existing Phase 1–8 domain objects (Lead, Call, ConversationState,
 * Qualification) to the provider-neutral `CrmContactPayload`.
 *
 * Rules:
 * - Pure function: no I/O, no HTTP, no SQL, no score recomputation.
 * - Missing/incomplete data is OMITTED (undefined), never inferred.
 * - HOT/WARM/COLD tier is a direct passthrough from Phase 8.
 * - Does not touch `leads.status`.
 */
import { Lead } from '../../models/lead';
import { Call } from '../../models/Call';
import { ConversationState } from '../../models/ConversationState';
import { Qualification } from '../../models/Qualification';
import { CrmContactPayload } from './crmProvider';

export interface CrmMappingInput {
  lead?: Lead | null;
  call?: Call | null;
  state?: ConversationState | null;
  qualification?: Qualification | null;
  /** Phase 7: explicit text-conversation anchor (no fake callId). */
  conversation?: { id: string; channel?: string | null } | null;
}

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const num = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

/** Normalize pg DATE (JS Date) or string to YYYY-MM-DD; missing/invalid -> undefined. */
const dateOnly = (value: unknown): string | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const sliced = value.trim().slice(0, 10);
    return sliced.length > 0 ? sliced : undefined;
  }
  return undefined;
};

export const toCrmContactPayload = (input: CrmMappingInput): CrmContactPayload => {
  const { lead, call, state, qualification } = input;

  const origin = text(state?.pickup_location);
  const destination = text(state?.destination);
  const route = origin && destination ? `${origin} -> ${destination}` : undefined;

  const payload: CrmContactPayload = {};

  const externalLeadId = lead?.id || state?.lead_id || qualification?.lead_id || call?.lead_id || null;
  if (externalLeadId) payload.external_lead_id = externalLeadId;
  const externalCallId = call?.id || state?.call_id || qualification?.call_id || null;
  if (externalCallId) payload.external_call_id = externalCallId;
  // Phase 7: conversation anchor prefers the explicit context, then the
  // qualification row lineage. Never fabricated from a call.
  const externalConversationId =
    input.conversation?.id || (qualification as Qualification & { conversation_id?: string | null })?.conversation_id || null;
  if (externalConversationId) payload.external_conversation_id = externalConversationId;
  if (call?.vapi_call_id) payload.vapi_call_id = call.vapi_call_id;

  const name = text(lead?.name) || text(state?.customer_name);
  if (name) payload.name = name;
  const phone = text(lead?.phone);
  if (phone) payload.phone = phone;
  const email = text(lead?.email);
  if (email) payload.email = email;
  const source = text(lead?.source);
  if (source) payload.lead_source = source;

  const customerName = text(state?.customer_name);
  if (customerName) payload.customer_name = customerName;
  if (origin) payload.origin = origin;
  if (destination) payload.destination = destination;
  if (route) payload.route = route;
  const vehicleType = text(state?.vehicle_type);
  if (vehicleType) payload.vehicle_type = vehicleType;
  const cargoType = text(state?.cargo_type);
  if (cargoType) payload.cargo_type = cargoType;
  const cargoWeight = num(state?.cargo_weight);
  if (cargoWeight !== undefined) payload.cargo_weight = cargoWeight;
  const cargoDimensions = text(state?.cargo_dimensions);
  if (cargoDimensions) payload.cargo_dimensions = cargoDimensions;
  const requiredDate = dateOnly(state?.required_date);
  if (requiredDate) payload.required_date = requiredDate;
  const budget = num(state?.budget);
  if (budget !== undefined) payload.budget = budget;
  const urgency = text(state?.urgency);
  if (urgency) payload.urgency = urgency;
  const bookingIntent = text(state?.booking_intent);
  if (bookingIntent) payload.booking_intent = bookingIntent;
  const additional = text(state?.additional_requirements);
  if (additional) payload.additional_requirements = additional;

  if (call?.started_at) payload.last_call_started_at = String(call.started_at);
  if (call?.ended_at) payload.last_call_ended_at = String(call.ended_at);
  if (call?.duration_seconds !== undefined && call?.duration_seconds !== null) {
    const duration = num(call.duration_seconds);
    if (duration !== undefined) payload.last_call_duration_seconds = duration;
  }
  const callStatus = text(call?.status);
  if (callStatus) payload.last_call_status = callStatus;

  // Tier passthrough: only the exact Phase 8 values are accepted.
  if (qualification) {
    if (typeof qualification.score === 'number' && Number.isFinite(qualification.score)) {
      payload.qualification_score = qualification.score;
    }
    if (
      qualification.tier === 'HOT' ||
      qualification.tier === 'WARM' ||
      qualification.tier === 'COLD'
    ) {
      payload.qualification_tier = qualification.tier;
    }
    if (qualification.qualified_at) payload.qualified_at = String(qualification.qualified_at);
    if (qualification.details !== undefined) payload.qualification_details = qualification.details;
  }

  return payload;
};
