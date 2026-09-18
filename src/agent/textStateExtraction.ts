import { ConversationStateRecord } from '../models/Conversation';

/**
 * Phase 4 — text-safe conversation state extraction + deterministic merge.
 *
 * The legacy voice path updates call-anchored state through Vapi tool calls
 * (see agent/tools.ts + vapiToolController.ts) and is intentionally untouched.
 * This module is the text-only counterpart: it derives a validated partial
 * update from a user message and merges it into `conversation_states`
 * (keyed by conversationId) without ever executing SQL itself.
 *
 * Safety rules:
 * - Only whitelisted slot columns are accepted; everything else is dropped.
 * - Unknown / empty / "unknown" values never overwrite known values.
 * - No SQL, filesystem, or tool execution happens here — pure data logic.
 */

export type TextStateUpdate = Partial<
  Pick<
    ConversationStateRecord,
    | 'customer_name'
    | 'pickup_location'
    | 'destination'
    | 'vehicle_type'
    | 'cargo_type'
    | 'cargo_weight'
    | 'cargo_dimensions'
    | 'required_date'
    | 'budget'
    | 'urgency'
    | 'booking_intent'
    | 'additional_requirements'
  >
>;

export const TEXT_STATE_FIELDS = [
  'customer_name',
  'pickup_location',
  'destination',
  'vehicle_type',
  'cargo_type',
  'cargo_weight',
  'cargo_dimensions',
  'required_date',
  'budget',
  'urgency',
  'booking_intent',
  'additional_requirements',
] as const;

export type TextStateField = (typeof TEXT_STATE_FIELDS)[number];

const UNKNOWN_TOKENS = new Set([
  '',
  'unknown',
  'not provided',
  'not_provided',
  'none',
  'n/a',
  'na',
  'null',
  'undefined',
  '-',
]);

/** Values that must leave an existing field unchanged when merged. */
export const isUnknownStateValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t.length === 0) return true;
    if (UNKNOWN_TOKENS.has(t)) return true;
    if (/^(not\s+(sure|known)|don'?t\s+know|tbd|to\s+be\s+decided)$/.test(t)) return true;
    return false;
  }
  if (typeof value === 'number') {
    return !Number.isFinite(value) || value <= 0;
  }
  return true;
};

export interface StateValidationResult {
  valid: boolean;
  sanitized: TextStateUpdate;
  errors: string[];
}

const MAX_TEXT_FIELD_LEN = 500;

const sanitizeTextField = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 || trimmed.length > MAX_TEXT_FIELD_LEN) return undefined;
  // Reject anything that looks like SQL / code injection rather than an address.
  if (/;\s*(select|insert|update|delete|drop|alter)\b/i.test(trimmed)) return undefined;
  if (/(__proto__|constructor\s*\[|process\.env|require\s*\()/.test(trimmed)) return undefined;
  if (isUnknownStateValue(trimmed)) return undefined;
  return trimmed;
};

const sanitizePositiveNumber = (value: unknown): number | undefined => {
  const num = typeof value === 'string' ? Number(value.replace(/[,₹\s]/g, '')) : value;
  if (typeof num !== 'number' || !Number.isFinite(num) || num <= 0) return undefined;
  return num;
};

/**
 * Validate an arbitrary (possibly LLM-produced) object into a safe partial
 * state update. Never throws on bad input — returns errors instead.
 * Only whitelisted fields survive; unknown keys are dropped silently.
 */
export const validateTextStateUpdate = (raw: unknown): StateValidationResult => {
  const errors: string[] = [];
  const sanitized: TextStateUpdate = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, sanitized, errors: ['State update must be a JSON object'] };
  }
  const input = raw as Record<string, unknown>;

  const textFields: TextStateField[] = [
    'customer_name',
    'pickup_location',
    'destination',
    'vehicle_type',
    'cargo_type',
    'cargo_dimensions',
    'required_date',
    'urgency',
    'additional_requirements',
  ];
  for (const field of textFields) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      errors.push(`${field} must be a string`);
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || isUnknownStateValue(trimmed)) continue; // leave unchanged
    const clean = sanitizeTextField(value);
    if (clean === undefined) {
      errors.push(`${field} is invalid and was ignored`);
      continue;
    }
    (sanitized as Record<string, unknown>)[field] = clean;
  }

  for (const field of ['cargo_weight', 'budget'] as const) {
    const value = input[field];
    if (value === undefined || value === null || value === '') continue;
    const num = sanitizePositiveNumber(value);
    if (num === undefined) {
      errors.push(`${field} must be a positive number`);
      continue;
    }
    (sanitized as Record<string, unknown>)[field] = num;
  }

  const intent = input['booking_intent'];
  if (intent !== undefined && intent !== null && String(intent).trim().length > 0) {
    const normalized = String(intent).trim().toLowerCase();
    if (normalized === 'unknown' || normalized === '') {
      // leave unchanged
    } else if (['explicit', 'not_explicit', 'unknown'].includes(normalized)) {
      sanitized.booking_intent = normalized as 'explicit' | 'not_explicit' | 'unknown';
    } else {
      errors.push('booking_intent must be explicit, not_explicit, or unknown');
    }
  }

  return { valid: errors.length === 0, sanitized, errors };
};

/**
 * Deterministic merge: unknown/null update values leave existing fields
 * unchanged; known values overwrite. Unrelated existing fields are preserved.
 * Pure function — no I/O, no SQL.
 */
export const mergeTextConversationState = <T extends Partial<ConversationStateRecord>>(
  existing: T | null | undefined,
  update: TextStateUpdate
): T & TextStateUpdate => {
  const base: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
  for (const field of TEXT_STATE_FIELDS) {
    const incoming = (update as Record<string, unknown>)[field];
    if (isUnknownStateValue(incoming)) continue;
    base[field] = incoming;
  }
  return base as T & TextStateUpdate;
};

// ---------------------------------------------------------------------------
// Deterministic heuristic extraction (no LLM / no I/O).
// Used as the text-safe extraction path: the controller runs this on every
// user turn, validates the result, merges, and persists via the repository.
// An LLM-JSON path can feed validateTextStateUpdate() later without changes.
// ---------------------------------------------------------------------------

const VEHICLE_KEYWORDS = [
  '14ft container',
  '20ft container',
  '32ft container',
  'container',
  'truck',
  'lorry',
  'trailer',
  'tempo',
  'mini truck',
  'pickup van',
  'tanker',
  'flatbed',
];

const URGENCY_KEYWORDS: Record<string, string[]> = {
  urgent: ['urgent', 'asap', 'immediately', 'emergency', 'same day'],
  high: ['high priority', 'priority', 'fast'],
  normal: ['normal', 'standard'],
  low: ['not urgent', 'flexible', 'whenever'],
};

/**
 * Best-effort deterministic slot extraction from a single user message.
 * Returns a validated partial update (possibly empty). Never throws.
 */
export const extractStateFromMessage = (message: string): TextStateUpdate => {
  const raw: Record<string, unknown> = {};
  if (!message || typeof message !== 'string') return {};
  const text = message.trim();
  if (text.length === 0) return {};
  const lower = text.toLowerCase();

  // Explicit pickup correction: "pickup should be X" / "pickup is X" / "from X"
  const pickupCorrection =
    text.match(/pickup\s+(?:should\s+be|is|:)\s*([A-Za-z][A-Za-z\s.'-]{1,60}?)(?:\s+and\b|[,.]|$)/i) ||
    text.match(/(?:^|\b)from\s+([A-Za-z][A-Za-z\s.'-]{1,60}?)(?:\s+to\b|[,.]|$)/i);
  if (pickupCorrection) {
    const val = pickupCorrection[1].trim().replace(/[.,;]+$/, '');
    if (val.length > 1) raw['pickup_location'] = val;
  }

  // Destination: "destination is X" / "destination X" / "to X" / "destination should be X"
  const destMatch =
    text.match(/destination\s+(?:(?:should\s+be|is|:)\s*)?([A-Za-z][A-Za-z\s.'-]{1,60})/i) ||
    text.match(/\bto\s+([A-Za-z][A-Za-z\s.'-]{1,60}?)(?:\s+from\b|[,.]|$)/i);
  if (destMatch) {
    const val = destMatch[1].trim().replace(/[.,;]+$/, '');
    // Avoid capturing verbs ("to ship", "to send", "to book")
    if (val.length > 1 && !/^(ship|send|book|move|transport|deliver)\b/i.test(val)) {
      raw['destination'] = val;
    }
  }

  // Vehicle type keyword scan
  for (const v of VEHICLE_KEYWORDS) {
    if (lower.includes(v)) {
      raw['vehicle_type'] = v
        .split(' ')
        .map((w) => (w === 'ft' ? 'ft' : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ');
      break;
    }
  }

  // Cargo weight: "500kg", "500 kg", "weight is 500"
  const weightMatch = text.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilos?|tonnes?|tons?)\b/i);
  if (weightMatch) {
    let num = Number(weightMatch[1]);
    const unit = weightMatch[2].toLowerCase();
    if (unit.startsWith('ton')) num = num * 1000;
    if (Number.isFinite(num) && num > 0) raw['cargo_weight'] = num;
  }

  // Budget: "budget 15000", "budget is INR 15000", "₹15000"
  const budgetMatch =
    text.match(/budget[^0-9₹]{0,10}(?:inr|rs\.?|₹)?\s*([0-9][0-9,]*)/i) ||
    text.match(/(?:inr|rs\.?|₹)\s*([0-9][0-9,]*)/i);
  if (budgetMatch) {
    const num = Number(budgetMatch[1].replace(/,/g, ''));
    if (Number.isFinite(num) && num > 0) raw['budget'] = num;
  }

  // Customer name: "my name is X" / "I am X" / "this is X"
  const nameMatch = text.match(/(?:my name is|i am|this is)\s+([A-Za-z][A-Za-z\s.'-]{1,60})/i);
  if (nameMatch) {
    const val = nameMatch[1].trim().replace(/[.,;]+$/, '');
    if (val.length > 1 && !/^(looking|trying|here)\b/i.test(val)) raw['customer_name'] = val;
  }

  // Required date: ISO YYYY-MM-DD
  const dateMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (dateMatch) raw['required_date'] = dateMatch[1];

  // Cargo type: "cargo is X" / "shipping X" / "transporting X"
  const cargoMatch = text.match(
    /(?:cargo\s+(?:is|type\s*(?:is|:)?)\s*|shipping\s+|transporting\s+)([A-Za-z][A-Za-z\s.'-]{1,40})/i
  );
  if (cargoMatch) {
    const val = cargoMatch[1].trim().replace(/[.,;]+$/, '');
    if (val.length > 1 && val.length < 60) raw['cargo_type'] = val;
  }

  // Urgency scan
  for (const [level, keywords] of Object.entries(URGENCY_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) {
      raw['urgency'] = level;
      break;
    }
  }

  // Booking intent
  if (/\b(book|confirm|proceed|yes.*book)\b/i.test(text) && lower.length < 200) {
    if (/\b(book|confirm booking|please book|want to book|proceed with booking)\b/i.test(text)) {
      raw['booking_intent'] = 'explicit';
    }
  }

  const { sanitized } = validateTextStateUpdate(raw);
  return sanitized;
};
