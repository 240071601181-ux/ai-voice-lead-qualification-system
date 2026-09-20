import { ConversationStateRecord } from '../models/Conversation';

/**
 * Phase 4 — text-safe conversation state extraction + deterministic merge.
 *
 * This module derives a validated partial update from a user message and
 * merges it into `conversation_states` (keyed by conversationId) without
 * ever executing SQL itself. (Phase 14: the legacy voice tool path is
 * retired; this text path is the primary state writer.)
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

/**
 * Render a state date value (ISO string, pg Date, or timestamp) as a short
 * YYYY-MM-DD date for prompts and customer-facing summaries. Raw Date
 * stringification ("...GMT+0530...") confuses the model and the customer,
 * so it must never reach rendered text.
 */
export const formatStateDate = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    return trimmed.slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return null;
};

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

/**
 * Scripts that legitimately appear in slot values. The LLM produces these
 * values (heuristic captures are already UNI-constrained), and small local
 * models garble Tamil into neighboring scripts (observed: Kannada
 * characters, stray combining marks) when writing tool arguments. Values
 * outside these blocks are model corruption, never customer language:
 *   Latin (+ extensions for names like José) and General Punctuation (– —),
 *   Tamil, Devanagari (Hindi names), ₹, ASCII digits/symbols via the ranges.
 * Pure-ASCII English values are unaffected by this guard.
 */
// \u0020-\u024F Latin/punct/digits, \u2000-\u206F general punctuation,
// \u20B9 rupees sign, \u0900-\u097F Devanagari, \u0B80-\u0BFF Tamil.
const STATE_VALUE_ALLOWED = new RegExp(
  '[\\u0020-\\u024F\\u2000-\\u206F\\u20B9\\u0900-\\u097F\\u0B80-\\u0BFF]'
);
/** Unassigned code points (observed: the model emitted U+0BBC, Cn here). */
const HAS_UNASSIGNED = /[\p{Cn}]/u;
/** Stray combining mark with no base character (broken grapheme cluster). */
const LEADING_MARK = /^[\p{M}]/u;

const hasDisallowedScript = (s: string): boolean => {
  for (const ch of s) {
    if (!STATE_VALUE_ALLOWED.test(ch)) return true;
  }
  return false;
};

const sanitizeTextField = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 || trimmed.length > MAX_TEXT_FIELD_LEN) return undefined;
  // Reject model-garbled script (never valid customer text in en/hi/ta).
  if (hasDisallowedScript(trimmed)) return undefined;
  if (HAS_UNASSIGNED.test(trimmed)) return undefined;
  if (LEADING_MARK.test(trimmed)) return undefined;
  // Reject anything that looks like SQL / code injection rather than an address.
  if (/;\s*(select|insert|update|delete|drop|alter)\b/i.test(trimmed)) return undefined;
  if (/(__proto__|constructor\s*\[|process\.env|require\s*\()/.test(trimmed)) return undefined;
  if (isUnknownStateValue(trimmed)) return undefined;
  return trimmed;
};

const sanitizePositiveNumber = (value: unknown): number | undefined => {
  const num =
    typeof value === 'string'
      ? Number(tamilDigitsToAscii(value).replace(/[,₹\s]|ரூபாய்|ரூ\.?/g, ''))
      : value;
  if (typeof num !== 'number' || !Number.isFinite(num) || num <= 0) return undefined;
  return num;
};

/**
 * Tamil-script digits (U+0BE6–U+0BEF) → ASCII. Users type either script;
 * the deterministic parsers below normalize before Number().
 */
export const tamilDigitsToAscii = (s: string): string =>
  s.replace(/[\u0BE6-\u0BEF]/g, (ch) => String('௦௧௨௩௪௫௬௭௮௯'.indexOf(ch)));

/** Latin + Tamil-script word characters for captured place/name values. */
const UNI = 'A-Za-z\\u0B80-\\u0BFF';

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
 * Exception: additional_requirements unions across turns (semicolon-separated
 * tokens, case-insensitive dedupe) so a later "temperature control" note
 * never erases an earlier "fragile" note. Pure function — no I/O, no SQL.
 */
export const mergeTextConversationState = <T extends Partial<ConversationStateRecord>>(
  existing: T | null | undefined,
  update: TextStateUpdate
): T & TextStateUpdate => {
  const base: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
  for (const field of TEXT_STATE_FIELDS) {
    const incoming = (update as Record<string, unknown>)[field];
    if (isUnknownStateValue(incoming)) continue;
    if (field === 'additional_requirements') {
      base[field] = unionRequirementTokens(base[field], incoming);
      continue;
    }
    base[field] = incoming;
  }
  return base as T & TextStateUpdate;
};

const splitRequirementTokens = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  return value
    .split(';')
    .map((t) => t.trim().replace(/\s+/g, ' '))
    .filter((t) => t.length > 0);
};

/** Union ';'-separated requirement tokens (case-insensitive dedupe, capped). */
export const unionRequirementTokens = (existing: unknown, incoming: unknown): string => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of [...splitRequirementTokens(existing), ...splitRequirementTokens(incoming)]) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out.join('; ').slice(0, 500);
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
  urgent: ['urgent', 'asap', 'immediately', 'emergency', 'same day', 'அவசர'],
  high: ['high priority', 'priority', 'fast'],
  normal: ['normal', 'standard'],
  low: ['flexible', 'whenever'],
};

/**
 * Explicit non-urgency negations. Checked BEFORE the positive keyword scan
 * so "not an emergency" / "it isn't urgent" never match the "emergency" /
 * "urgent" keywords above. A negation always resolves to the canonical
 * non-urgent representation ("normal" — an existing urgency level).
 */
const URGENCY_NEGATIONS = [
  /\bnot\s+(?:an?\s+)?emergency\b/i,
  /\bnot\s+urgent\b/i,
  /\bisn'?t\s+urgent\b/i,
  /\bthis\s+is\s+not\s+urgent\b/i,
  /\bno\s+urgency\b/i,
  /\bno\s+(?:rush|hurry)\b/i,
  /\bnot\s+time[\s-]*sensitive\b/i,
];

const hasUrgencyNegation = (text: string): boolean =>
  URGENCY_NEGATIONS.some((re) => re.test(text));

/** Handling signals that become additional_requirements tokens (never cargo). */
const REQUIREMENT_SIGNALS: Array<{ test: RegExp; label: string }> = [
  { test: /\bfragil(?:e|ity)\b/i, label: 'fragile' },
  { test: /temperature[\s-]*control(?:led)?\b/i, label: 'temperature control important' },
  { test: /\bcold\s*chain\b/i, label: 'cold chain required' },
];

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/**
 * Resolve "next <weekday>" (also "this/on <weekday>") to an ISO YYYY-MM-DD
 * date: the first such weekday strictly after the reference day. Pure and
 * deterministic; `now` is injectable for tests (defaults to today).
 * required_date and urgency stay independent — a date never implies urgency.
 */
export const resolveWeekdayDate = (
  message: string,
  now: Date = new Date()
): string | null => {
  if (!message || typeof message !== 'string') return null;
  const match = message.match(
    /\b(?:next|this|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i
  );
  if (!match) return null;
  const target = WEEKDAYS.indexOf(match[1].toLowerCase() as (typeof WEEKDAYS)[number]);
  let diff = (target - now.getDay() + 7) % 7;
  if (diff === 0) diff = 7; // "next Tuesday" on a Tuesday = 7 days out
  const out = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${out.getFullYear()}-${pad(out.getMonth() + 1)}-${pad(out.getDate())}`;
};

/**
 * Terminator lookahead for cargo noun phrases: the description ends before
 * route/time/motive clauses or punctuation. Lets long descriptions (up to
 * the DB-supported ~100 chars) survive without swallowing the rest of the
 * sentence.
 */
const CARGO_TERMINATOR =
  '(?=\\s+(?:from|to|for|with|but|because|next|required|budget|pickup|destination|my\\b|i\\b|me\\b|we\\b)|[,.;!?]|$)';
const CARGO_PHRASE = `([A-Za-z][A-Za-z\\s.'-]{1,90}?)\\s*${CARGO_TERMINATOR}`;

/**
 * Best-effort deterministic slot extraction from a single user message.
 * Returns a validated partial update (possibly empty). Never throws.
 * `now` anchors relative weekday dates ("next Tuesday"); defaults to today.
 */
export const extractStateFromMessage = (message: string, options: { now?: Date } = {}): TextStateUpdate => {
  const raw: Record<string, unknown> = {};
  if (!message || typeof message !== 'string') return {};
  const text = message.trim();
  if (text.length === 0) return {};
  const lower = text.toLowerCase();

  // Explicit pickup correction: "pickup should be X" / "pickup is X" / "from X".
  // Values may use Tamil script ("Pickup சென்னை"); terminators keep a
  // following English field marker (destination/to/budget/...) out of the value.
  // Bare "pickup X" is accepted only when X is not a question word
  // ("What is my pickup location?" must not capture "location").
  const pickupCorrection =
    text.match(
      new RegExp(
        `pickup\\s+(?:should\\s+be|is|:)\\s*([${UNI}][${UNI}\\s.'-]{1,60}?)(?:\\s+(?:and|destination|to|budget|pickup)\\b|[,.]|$)`,
        'i'
      )
    ) ||
    text.match(/(?:^|\b)from\s+([A-Za-z][A-Za-z\s.'-]{1,60}?)(?:\s+to\b|[,.]|$)/i) ||
    text.match(
      new RegExp(
        `pickup\\s+([${UNI}][${UNI}\\s.'-]{1,30}?)(?:\\s+(?:and|destination|to|budget|pickup)\\b|[,.]|$)`,
        'i'
      )
    );
  if (pickupCorrection) {
    const val = pickupCorrection[1].trim().replace(/[.,;]+$/, '');
    if (val.length > 1 && !/^(location|address|date|time|details?|info|points?)\b/i.test(val)) {
      raw['pickup_location'] = val;
    }
  }

  // Destination: "destination is X" / "destination X" / "to X" / "destination should be X".
  // Tamil-script values allowed with the same English markers. Lazy with an
  // explicit terminator so trailing clauses ("destination Bangalore. Budget
  // 20000") never pollute the value.
  const destMatch =
    text.match(
      new RegExp(
        `destination\\s+(?:(?:should\\s+be|is|:)\\s*)?([${UNI}][${UNI}\\s.'-]{1,60}?)(?:\\s+(?:from|budget|pickup|and)\\b|[,.]|$)`,
        'i'
      )
    ) ||
    text.match(/\bto\s+([A-Za-z][A-Za-z\s.'-]{1,60}?)(?:\s+from\b|[,.]|$)/i);
  if (destMatch) {
    const val = destMatch[1].trim().replace(/[.,;]+$/, '');
    // Avoid capturing verbs ("to ship", "to send", "to book")
    if (val.length > 1 && !/^(ship|send|book|move|transport|deliver)\b/i.test(val)) {
      raw['destination'] = val;
    }
  }

  // Vehicle type keyword scan (English). Tamil-script vehicle words map to
  // the same English canonical values so scoring/memory stay consistent.
  for (const v of VEHICLE_KEYWORDS) {
    if (lower.includes(v)) {
      raw['vehicle_type'] = v
        .split(' ')
        .map((w) => (w === 'ft' ? 'ft' : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ');
      break;
    }
  }
  if (!raw['vehicle_type']) {
    const TAMIL_VEHICLES: Array<[RegExp, string]> = [
      [/டிரக்/, 'Truck'],
      [/லாரி/, 'Lorry'],
      [/வேன்/, 'Van'],
      [/கண்டெய்னர்/, 'Container'],
      [/டெம்போ/, 'Tempo'],
      [/டேங்கர்/, 'Tanker'],
    ];
    for (const [re, canonical] of TAMIL_VEHICLES) {
      if (re.test(text)) {
        raw['vehicle_type'] = canonical;
        break;
      }
    }
  }

  // Cargo weight: "500kg", "500 kg", "weight is 500", "500 கிலோ", "2 டன்".
  // Tamil digits are normalized; Tamil units map to kg/tonnes. The trailing
  // boundary is script-aware: JS \b never matches around Tamil letters.
  const weightMatch = text.match(
    /([\d\u0BE6-\u0BEF]+(?:\.[\d\u0BE6-\u0BEF]+)?)\s*((?:kg|kgs|kilos?|tonnes?|tons?)\b|(?:கிலோ(?:கிராம்)?|டன்(?:கள்)?)(?![A-Za-z\u0B80-\u0BFF]))/i
  );
  if (weightMatch) {
    let num = Number(tamilDigitsToAscii(weightMatch[1]));
    const unit = weightMatch[2].toLowerCase();
    if (unit.startsWith('ton') || unit.startsWith('டன்')) num = num * 1000;
    if (Number.isFinite(num) && num > 0) raw['cargo_weight'] = num;
  }

  // Budget: "budget 15000", "budget is INR 15000", "₹15000", "Budget 20000 ரூபாய்".
  const budgetMatch =
    text.match(/budget[^0-9₹\u0BE6-\u0BEF]{0,10}(?:inr|rs\.?|₹|ரூபாய்|ரூ\.?)?\s*([\d\u0BE6-\u0BEF][\d\u0BE6-\u0BEF,]*)/i) ||
    text.match(/(?:inr|rs\.?|₹|ரூபாய்|ரூ\.?)\s*([\d\u0BE6-\u0BEF][\d\u0BE6-\u0BEF,]*)/i);
  if (budgetMatch) {
    const num = Number(tamilDigitsToAscii(budgetMatch[1]).replace(/,/g, ''));
    if (Number.isFinite(num) && num > 0) raw['budget'] = num;
  }

  // Tamil correction requests: "<field>(-ஐ) <value> (ஆக|என்று) மாற்று…"
  // ("என்னுடைய pickup-ஐ Tambaram ஆக மாற்றுங்கள்" → pickup_location=Tambaram).
  // Deterministic so the slot is corrected even when the small local model
  // fumbles the native tool call for Tamil; the following LLM turn then
  // acknowledges the already-persisted value. Runs after the plain captures
  // above so the correction (latest intent) wins within one message.
  // English text is untouched by this block (மாற்று never appears there).
  const changePos = text.search(/மாற்ற[\u0B80-\u0BFF]*/);
  if (changePos > 0) {
    const before = text.slice(0, changePos);
    let correctionField: TextStateField | null = null;
    if (/pickup/i.test(before)) correctionField = 'pickup_location';
    else if (/destination/i.test(before)) correctionField = 'destination';
    else if (/\bvehicle\b/i.test(before)) correctionField = 'vehicle_type';
    else if (/\bbudget\b/i.test(before)) correctionField = 'budget';
    else if (/(?:\bname\b|பெயர்)/i.test(before)) correctionField = 'customer_name';
    else if (/\bcargo\b/i.test(before)) correctionField = 'cargo_type';
    if (correctionField) {
      const markerStrip =
        correctionField === 'pickup_location'
          ? /pickup(?:\s+location)?(?:-ஐ)?/i
          : correctionField === 'destination'
            ? /destination(?:-ஐ)?/i
            : correctionField === 'vehicle_type'
              ? /\bvehicle(?:\s+type)?(?:-ஐ)?/i
              : correctionField === 'budget'
                ? /\bbudget(?:-ஐ)?/i
                : correctionField === 'customer_name'
                  ? /(?:\bname\b|பெயர்)(?:-ஐ)?/i
                  : /\bcargo(?:\s+type)?(?:-ஐ)?/i;
      let corrected = before
        .replace(/^(?:என்னுடைய|எனது|என்)\s+/, '')
        .replace(markerStrip, '')
        .replace(/-ஐ/g, '')
        .replace(/\s*(?:ஆக|என்று)\s*$/, '')
        .trim()
        .replace(/[.,;]+$/, '');
      // Reverse the ஆக-adverbial fusion glued onto the value
      // ("தாம்பரமாக" = தாம்பரம் + ஆக, "சென்னையாக" = சென்னை + ஆக).
      // Only the unambiguous endings are reversed; anything else stays
      // well-formed Tamil for the LLM turn to refine. Correction only.
      if (corrected.length > 4) {
        if (/மாக$/.test(corrected)) corrected = corrected.replace(/மாக$/, 'ம்');
        else if (/யாக$/.test(corrected)) corrected = corrected.replace(/யாக$/, '');
        else if (/வாக$/.test(corrected)) corrected = corrected.replace(/வாக$/, '');
      }
      corrected = corrected.trim();
      if (correctionField === 'budget') {
        const num = Number(tamilDigitsToAscii(corrected).replace(/[^0-9]/g, ''));
        if (Number.isFinite(num) && num > 0) raw['budget'] = num;
      } else if (
        corrected.length > 1 &&
        !/^(location|address|என்ன|எது)\b/i.test(corrected)
      ) {
        raw[correctionField] = corrected;
      }
    }
  }
  // Customer name: "my name is X" / "I am X" / "this is X" /
  // "என் பெயர் X" / "எனது பெயர் X".
  const nameMatch = text.match(
    new RegExp(
      `(?:my name is|i am|this is|என் பெயர்|எனது பெயர்)\\s*([${UNI}][${UNI}\\s.'-]{1,60}?)(?:[,.]|$)`,
      'i'
    )
  );
  if (nameMatch) {
    const val = nameMatch[1].trim().replace(/[.,;]+$/, '');
    if (val.length > 1 && !/^(looking|trying|here)\b/i.test(val)) raw['customer_name'] = val;
  }

  // Required date: ISO YYYY-MM-DD, else relative weekday ("next Tuesday").
  // A date never implies urgency — the two fields stay independent.
  const dateMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (dateMatch) {
    raw['required_date'] = dateMatch[1];
  } else {
    const weekdayDate = resolveWeekdayDate(text, options.now);
    if (weekdayDate) raw['required_date'] = weekdayDate;
  }

  // Cargo type: "cargo is X" / "shipping X" / "transporting X" /
  // "move <weight> of X" / explicit "Actually (the cargo/it is) X" corrections.
  // Full phrases survive (DB supports ~100 chars); clauses after route/time
  // prepositions are excluded via the terminator lookahead.
  // Bare handling adjectives belong to additional_requirements, never cargo.
  const NON_CARGO_ADJECTIVES = new Set(['fragile', 'fragility', 'urgent', 'normal', 'important']);
  const cleanCargo = (val: string): string | null => {
    const clean = val.trim().replace(/[.,;]+$/, '');
    if (clean.length <= 1 || clean.length > 95) return null;
    if (NON_CARGO_ADJECTIVES.has(clean.toLowerCase())) return null;
    return clean;
  };
  // Alternatives are tried in order; the first one yielding a usable
  // (non-adjective) value wins. A truthy-but-unusable match (e.g. "cargo
  // is fragile" later in the sentence) must not shadow a real description.
  const cargoAlternatives = [
    new RegExp(`(?:cargo\\s+(?:is|type\\s*(?:is|:)?)\\s*|shipping\\s+|transporting\\s+)${CARGO_PHRASE}`, 'i'),
    new RegExp(`\\bmove\\s+[\\d.]+\\s*(?:kg|kgs?|kilos?|tonnes?|tons?)\\s+of\\s+${CARGO_PHRASE}`, 'i'),
    // Tamil: "<description> பொருட்கள்" ("500 கிலோ எலக்ட்ரானிக்ஸ் பொருட்கள்"
    // → "எலக்ட்ரானிக்ஸ்"; a leading weight measure is skipped, not captured).
    new RegExp(
      `(?:[\\d\\u0BE6-\\u0BEF.,]+\\s*(?:kg|kgs?|kilos?|tonnes?|tons?|கிலோ(?:கிராம்)?|டன்(?:கள்)?)\\s+)?([\\u0B80-\\u0BFF][\\u0B80-\\u0BFF\\s.'-]{1,60}?)\\s+பொரு(?:ள்|ட்கள்)(?![\\u0B80-\\u0BFF])`,
      'i'
    ),
  ];
  let cargoVal: string | null = null;
  for (const re of cargoAlternatives) {
    const m = text.match(re);
    if (m) {
      // A leading weight measure ("500 கிலோ X", "2 tons of X") belongs to
      // cargo_weight, never to the description.
      const cleaned = cleanCargo(
        m[1].replace(
          /^(?:[\d\u0BE6-\u0BEF.,]+\s*(?:kg|kgs?|kilos?|tonnes?|tons?|கிலோ(?:கிராம்)?|டன்(?:கள்)?)\s+)+/i,
          ''
        )
      );
      if (cleaned) {
        cargoVal = cleaned;
        break;
      }
    }
  }
  if (cargoVal) {
    raw['cargo_type'] = cargoVal;
  } else {
    // Correction form ("Actually it is X" / "Actually, the cargo is X").
    // Requires a multi-word phrase so bare handling adjectives ("It is
    // fragile") route to additional_requirements instead of cargo_type.
    const correction = text.match(
      new RegExp(`\\bactually\\s*,?\\s*(?:the\\s+cargo\\s+is|it\\s+is|it'?s)\\s+${CARGO_PHRASE}`, 'i')
    );
    if (correction) {
      const val = cleanCargo(correction[1]);
      if (val && val.trim().split(/\s+/).length > 1) raw['cargo_type'] = val;
    }
  }

  // Handling requirements: every matching signal is preserved ("fragile;
  // temperature control important"). Never collapses into cargo_type.
  const requirementLabels = REQUIREMENT_SIGNALS.filter((s) => s.test.test(text)).map(
    (s) => s.label
  );
  if (requirementLabels.length > 0) {
    raw['additional_requirements'] = requirementLabels.join('; ');
  }

  // Urgency: explicit negations win over every positive keyword, so "not an
  // emergency" resolves to the canonical non-urgent level ("normal") instead
  // of matching the "emergency" keyword. Corrections therefore override.
  if (hasUrgencyNegation(text)) {
    raw['urgency'] = 'normal';
  } else {
    for (const [level, keywords] of Object.entries(URGENCY_KEYWORDS)) {
      if (keywords.some((k) => lower.includes(k))) {
        raw['urgency'] = level;
        break;
      }
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
