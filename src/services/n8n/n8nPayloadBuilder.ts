/**
 * Phase 10 – pure n8n payload builders.
 *
 * Maps existing Phase 1–9 domain objects to allowlisted n8n event envelopes.
 * Pure functions: no I/O, no HTTP, no SQL, no business-logic recomputation.
 * Missing data is omitted, never inferred. Qualification tier is verbatim.
 */
import { Lead } from '../../models/lead';
import { Call } from '../../models/Call';
import { ConversationState } from '../../models/ConversationState';
import { Qualification } from '../../models/Qualification';
import {
  N8nCallFields,
  N8nCrmFields,
  N8nEnvelope,
  N8nEventData,
  N8nEventName,
  N8nLeadFields,
  N8nQualificationFields,
  N8nShipmentFields
} from './n8nEventTypes';
import { n8nDateOnly, n8nNum, n8nText } from './eventFieldUtils';

export interface N8nBuildInput {
  lead?: Lead | null;
  call?: Call | null;
  state?: ConversationState | null;
  qualification?: Qualification | null;
  crm?: N8nCrmFields | null;
  /** Phase 7: text-conversation anchor + source marker (omitted for legacy). */
  conversation?: { id: string; channel?: string | null; status?: string | null } | null;
  source?: 'conversation' | 'legacy_call' | null;
}

export const buildN8nEventId = (
  event: N8nEventName,
  anchor: string,
  discriminator?: number
): string => {
  const base = `n8n:${event}:${anchor}`;
  return discriminator && discriminator > 1 ? `${base}:${discriminator}` : base;
};

const buildLeadFields = (lead?: Lead | null): N8nLeadFields | undefined => {
  if (!lead) return undefined;
  const fields: N8nLeadFields = {};
  if (lead.id) fields.id = lead.id;
  const source = n8nText(lead.source);
  if (source) fields.source = source;
  const name = n8nText(lead.name);
  if (name) fields.name = name;
  const phone = n8nText(lead.phone);
  if (phone) fields.phone = phone;
  const email = n8nText(lead.email);
  if (email) fields.email = email;
  const status = n8nText(lead.status);
  if (status) fields.status = status;
  return Object.keys(fields).length > 0 ? fields : undefined;
};

const buildCallFields = (call?: Call | null): N8nCallFields | undefined => {
  if (!call) return undefined;
  const fields: N8nCallFields = {};
  if (call.id) fields.id = call.id;
  if (call.vapi_call_id) fields.vapi_call_id = call.vapi_call_id;
  if (call.lead_id) fields.lead_id = call.lead_id;
  const status = n8nText(call.status);
  if (status) fields.status = status;
  if (call.started_at) fields.started_at = String(call.started_at);
  if (call.answered_at) fields.answered_at = String(call.answered_at);
  if (call.ended_at) fields.ended_at = String(call.ended_at);
  const duration = n8nNum(call.duration_seconds);
  if (duration !== undefined) fields.duration_seconds = duration;
  return Object.keys(fields).length > 0 ? fields : undefined;
};

const buildShipmentFields = (state?: ConversationState | null): N8nShipmentFields | undefined => {
  if (!state) return undefined;
  const fields: N8nShipmentFields = {};
  const assign = (key: keyof N8nShipmentFields, value: string | number | undefined) => {
    if (value !== undefined) (fields as Record<string, unknown>)[key] = value;
  };
  assign('customer_name', n8nText(state.customer_name));
  assign('pickup_location', n8nText(state.pickup_location));
  assign('destination', n8nText(state.destination));
  assign('vehicle_type', n8nText(state.vehicle_type));
  assign('cargo_type', n8nText(state.cargo_type));
  assign('cargo_weight', n8nNum(state.cargo_weight));
  assign('cargo_dimensions', n8nText(state.cargo_dimensions));
  assign('required_date', n8nDateOnly(state.required_date));
  assign('budget', n8nNum(state.budget));
  assign('urgency', n8nText(state.urgency));
  assign('booking_intent', n8nText(state.booking_intent));
  assign('additional_requirements', n8nText(state.additional_requirements));
  return Object.keys(fields).length > 0 ? fields : undefined;
};

const buildQualificationFields = (
  qualification?: Qualification | null
): N8nQualificationFields | undefined => {
  if (!qualification) return undefined;
  const fields: N8nQualificationFields = {};
  if (qualification.id) fields.id = qualification.id;
  if (qualification.call_id) fields.call_id = qualification.call_id;
  const conversationId = (qualification as Qualification & { conversation_id?: string | null })
    ?.conversation_id;
  if (conversationId) fields.conversation_id = conversationId;
  if (qualification.lead_id) fields.lead_id = qualification.lead_id;
  if (typeof qualification.score === 'number' && Number.isFinite(qualification.score)) {
    fields.score = qualification.score;
  }
  if (
    qualification.tier === 'HOT' ||
    qualification.tier === 'WARM' ||
    qualification.tier === 'COLD'
  ) {
    fields.tier = qualification.tier;
  }
  if (qualification.qualified_at) fields.qualified_at = String(qualification.qualified_at);
  if (qualification.details !== undefined) fields.details = qualification.details;
  return Object.keys(fields).length > 0 ? fields : undefined;
};

export const buildN8nEnvelope = (
  event: N8nEventName,
  anchor: string,
  input: N8nBuildInput,
  occurredAt = new Date().toISOString(),
  discriminator?: number
): N8nEnvelope => {
  const data: N8nEventData = {};
  const lead = buildLeadFields(input.lead);
  if (lead) data.lead = lead;
  const call = buildCallFields(input.call);
  if (call) data.call = call;
  const shipment = buildShipmentFields(input.state);
  if (shipment) data.shipment = shipment;
  const qualification = buildQualificationFields(input.qualification);
  if (qualification) data.qualification = qualification;
  if (input.crm) data.crm = input.crm;
  // Phase 7: source/conversation markers are set only for text-conversation
  // events; legacy envelopes serialize byte-identically to before.
  if (input.source) data.source = input.source;
  if (input.conversation?.id) {
    data.conversation = {
      id: input.conversation.id,
      ...(input.conversation.channel ? { channel: input.conversation.channel } : {}),
      ...(input.conversation.status ? { status: input.conversation.status } : {}),
    };
  }
  return {
    event,
    event_id: buildN8nEventId(event, anchor, discriminator),
    occurred_at: occurredAt,
    data
  };
};

/** Canonical body bytes covered by the HMAC signature (signature field excluded). */
export const canonicalN8nBody = (envelope: N8nEnvelope): string =>
  JSON.stringify({ event: envelope.event, event_id: envelope.event_id, occurred_at: envelope.occurred_at, data: envelope.data });
