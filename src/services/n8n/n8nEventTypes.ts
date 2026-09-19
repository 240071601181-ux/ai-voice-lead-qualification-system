/**
 * Phase 10 – n8n event type definitions.
 *
 * Backend domain events fanned out to n8n workflows via outbound HTTPS
 * webhooks. n8n is never in the real-time LLM loop: delivery happens
 * only in async tails (fire-and-forget), and the LLM has no path to n8n.
 *
 * Phase 14: no active emitter produces `call.completed` (voice retired);
 * the name stays allowlisted so subscribed workflows and historical
 * replays keep validating. New events are conversation-anchored
 * (`source: 'conversation'`).
 */

export const N8N_EVENTS = [
  'lead.created',
  'lead.updated',
  'call.completed',
  'qualification.completed',
  'crm_sync.completed',
  /** Phase 8: emitted after an explicit conversation meeting booking. */
  'meeting.scheduled'
] as const;

export type N8nEventName = (typeof N8N_EVENTS)[number];

export interface N8nLeadFields {
  id?: string | null;
  source?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
}

export interface N8nCallFields {
  id?: string | null;
  vapi_call_id?: string | null;
  lead_id?: string | null;
  status?: string | null;
  started_at?: string | null;
  answered_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
}

export interface N8nShipmentFields {
  customer_name?: string | null;
  pickup_location?: string | null;
  destination?: string | null;
  vehicle_type?: string | null;
  cargo_type?: string | null;
  cargo_weight?: number | null;
  cargo_dimensions?: string | null;
  required_date?: string | null;
  budget?: number | null;
  urgency?: string | null;
  booking_intent?: string | null;
  additional_requirements?: string | null;
}

export interface N8nQualificationFields {
  id?: string | null;
  call_id?: string | null;
  /** Phase 7: conversation anchor for text qualifications (no fake callId). */
  conversation_id?: string | null;
  lead_id?: string | null;
  score?: number | null;
  /** Verbatim Phase 8 tier passthrough. */
  tier?: 'HOT' | 'WARM' | 'COLD' | null;
  qualified_at?: string | null;
  details?: unknown;
}

export interface N8nCrmFields {
  provider?: string | null;
  crm_contact_id?: string | null;
  ok?: boolean | null;
  skipped?: string | null;
}

/** Allowlisted per-event data body. Never transcripts or full history. */
export interface N8nEventData {
  lead?: N8nLeadFields | null;
  call?: N8nCallFields | null;
  shipment?: N8nShipmentFields | null;
  qualification?: N8nQualificationFields | null;
  crm?: N8nCrmFields | null;
  /** Phase 7: distinguishes text-conversation events from legacy call events. */
  source?: 'conversation' | 'legacy_call' | null;
  /** Phase 7: text-conversation anchor (present only for conversation events). */
  conversation?: N8nConversationFields | null;
  /** Phase 8: explicit meeting booking details (meeting.scheduled only). */
  meeting?: N8nMeetingFields | null;
}

export interface N8nMeetingFields {
  bookingId?: string | null;
  provider?: string | null;
  start?: string | null;
  end?: string | null;
  meetUrl?: string | null;
}

export interface N8nConversationFields {
  id?: string | null;
  channel?: string | null;
  status?: string | null;
}

export interface N8nEnvelope {
  event: N8nEventName;
  /** Stable idempotency key `n8n:{event}:{anchor}[:{discriminator}]`. */
  event_id: string;
  occurred_at: string;
  data: N8nEventData;
}
