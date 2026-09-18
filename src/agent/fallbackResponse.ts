/**
 * Deterministic customer-facing fallback for text turns where the LLM did
 * not produce a usable final response (empty content, tool-call JSON leak,
 * or model-emitted "working on it" placeholder).
 *
 * Ground rules (never violated):
 * - Only persisted state is reported — never invented business facts.
 * - Only successfully completed actions are confirmed.
 * - The next question targets the first still-missing qualification field.
 * - No JSON, no tool syntax, no internal metadata ever reaches the text.
 */
import { isJsonToolCallContent, looksLikeJsonToolCall } from './conversationTools';

/** Internal "still working" phrasing that must never reach the customer. */
const PLACEHOLDER_PATTERNS = [
  'working on your request',
  'working on it',
  'one moment',
  'processing...',
  'processing your request',
  'executing tool',
  'calling function',
  'running the tool',
];

/** Long messages containing these phrases are treated as real content. */
const PLACEHOLDER_MAX_LENGTH = 300;

/** True when assistant content is obvious internal placeholder phrasing. */
export const isPlaceholderLike = (content: unknown): boolean => {
  if (typeof content !== 'string') return false;
  const text = content.trim();
  if (text.length === 0 || text.length > PLACEHOLDER_MAX_LENGTH) return false;
  const lower = text.toLowerCase();
  return PLACEHOLDER_PATTERNS.some((p) => lower.includes(p));
};

/**
 * True when the final content is unusable for the customer: empty, raw
 * tool-call JSON (well-formed or truncated), or placeholder phrasing.
 * Usable model text — including error explanations and long messages —
 * always returns false.
 */
export const isUnusableFinalContent = (content: unknown): boolean => {
  if (typeof content !== 'string' || content.trim().length === 0) return true;
  if (isJsonToolCallContent(content) || looksLikeJsonToolCall(content)) return true;
  return isPlaceholderLike(content);
};

export interface FallbackState {
  customer_name?: unknown;
  pickup_location?: unknown;
  destination?: unknown;
  vehicle_type?: unknown;
  cargo_type?: unknown;
  cargo_weight?: unknown;
  required_date?: unknown;
  budget?: unknown;
  urgency?: unknown;
}

const nonEmpty = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Qualification order: first missing field drives the next question. */
const NEXT_QUESTION: Array<{ field: keyof FallbackState; ask: string }> = [
  { field: 'pickup_location', ask: 'What is your pickup location?' },
  { field: 'destination', ask: 'Where should the shipment be delivered?' },
  { field: 'vehicle_type', ask: 'What type of vehicle do you need (e.g. truck, container, tempo)?' },
  { field: 'cargo_weight', ask: 'What is the approximate cargo weight?' },
  { field: 'budget', ask: 'What is your budget for this shipment?' },
  { field: 'required_date', ask: 'When do you need the delivery?' },
  { field: 'customer_name', ask: 'May I have your name?' },
  { field: 'cargo_type', ask: 'What type of cargo is it?' },
  { field: 'urgency', ask: 'How urgent is this requirement?' },
];

const describeKnown = (state: FallbackState): string[] => {
  const parts: string[] = [];
  const show = (label: string, value: string | null) => {
    if (value) parts.push(`${label} ${value}`);
  };
  show('pickup', nonEmpty(state.pickup_location));
  show('destination', nonEmpty(state.destination));
  show('vehicle', nonEmpty(state.vehicle_type));
  show('cargo', nonEmpty(state.cargo_type));
  const weight = nonEmpty(state.cargo_weight);
  if (weight) parts.push(`cargo weight ${weight} kg`);
  show('delivery date', nonEmpty(state.required_date));
  const budget = nonEmpty(state.budget);
  if (budget) parts.push(`budget INR ${budget}`);
  show('contact name', nonEmpty(state.customer_name));
  show('urgency', nonEmpty(state.urgency));
  return parts;
};

const nextMissingQuestion = (state: FallbackState): string => {
  for (const { field, ask } of NEXT_QUESTION) {
    if (nonEmpty((state as Record<string, unknown>)[field]) === null) return ask;
  }
  return 'Is there anything else I can help with for this shipment?';
};

export interface FallbackContext {
  /** True when this turn actually stored/updated state (tool or heuristic). */
  updatedThisTurn: boolean;
}

/**
 * Compose a useful deterministic reply grounded ONLY in persisted state.
 * - With recorded details: confirm them, then ask the next missing field.
 * - With nothing recorded: greet and start qualification at pickup.
 */
export const buildInformativeFallback = (
  state: FallbackState | null | undefined,
  ctx: FallbackContext
): string => {
  const known = describeKnown(state ?? {});
  if (known.length === 0) {
    return 'Hello! I can help arrange your shipment. To get started, what is your pickup location?';
  }
  const lead = ctx.updatedThisTurn
    ? `Got it — I've recorded ${known.join(', ')}.`
    : `Here's what I have on file for your shipment: ${known.join(', ')}.`;
  return `${lead} ${nextMissingQuestion(state ?? {})}`;
};
