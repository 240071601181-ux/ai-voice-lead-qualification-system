import { ConversationChannel, ConversationStatus } from '../agent/conversation';

/**
 * Text conversation row (table: conversations).
 * DB-mapped snake_case, mirroring the style of models/lead.ts.
 */
export interface Conversation {
  id: string; // UUID
  lead_id?: string | null;
  channel: ConversationChannel;
  status: ConversationStatus;
  started_at?: string | null; // ISO timestamp
  ended_at?: string | null; // ISO timestamp
  created_at: string;
  updated_at: string;
}

export type ConversationMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export const CONVERSATION_MESSAGE_ROLES: ConversationMessageRole[] = [
  'system',
  'user',
  'assistant',
  'tool',
];

/**
 * Single turn row (table: conversation_messages).
 */
export interface ConversationMessage {
  id: string; // UUID
  conversation_id: string; // UUID reference to conversations.id
  role: ConversationMessageRole;
  content: string;
  metadata?: Record<string, unknown> | null;
  tool_calls?: unknown | null;
  created_at: string;
}

/**
 * Slot state row for a text conversation (table: conversation_states).
 * Mirrors models/ConversationState field types, keyed by conversation_id
 * instead of call_id. The legacy ConversationState (call-anchored) remains
 * untouched for voice compatibility.
 */
export interface ConversationStateRecord {
  id: string; // UUID
  conversation_id: string; // UUID reference to conversations.id
  lead_id?: string | null;
  customer_name?: string | null;
  pickup_location?: string | null;
  destination?: string | null;
  vehicle_type?: string | null;
  cargo_type?: string | null;
  cargo_weight?: number | null;
  cargo_dimensions?: string | null;
  required_date?: string | null; // ISO date
  budget?: number | null;
  urgency?: string | null;
  booking_intent?: 'explicit' | 'not_explicit' | 'unknown' | null;
  additional_requirements?: string | null;
  created_at: string;
  updated_at: string;
}
