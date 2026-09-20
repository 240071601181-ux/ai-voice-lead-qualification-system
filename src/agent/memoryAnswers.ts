/**
 * Deterministic memory answers for factual state questions.
 *
 * When the user asks about a known conversation-state field ("What is my
 * name?"), the answer is composed directly from the persisted state —
 * exactly the requested field, never a full shipment summary, never
 * invented. Unknown fields return null so the normal LLM turn (which asks
 * a follow-up) handles them. RAG is never consulted here.
 *
 * Pure data logic: no SQL, no LLM, no side effects. Safe to unit test.
 */

export interface MemoryState {
  customer_name?: string | null;
  pickup_location?: string | null;
  destination?: string | null;
  vehicle_type?: string | null;
  cargo_type?: string | null;
  cargo_weight?: number | string | null;
  cargo_dimensions?: string | null;
  required_date?: string | null;
  budget?: number | string | null;
  urgency?: string | null;
  booking_intent?: 'explicit' | 'not_explicit' | 'unknown' | null;
}

type FieldKey =
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
  | 'booking_intent';

/**
 * Word boundaries that understand Tamil script. JS `\b` only spans ASCII
 * word chars, so it never matches around Tamil letters (both sides are
 * "non-word"). TA_END asserts "not followed by a letter" and TA_WORD
 * anchors Tamil alternatives on surrounding separators instead.
 */
const TA_END = '(?![A-Za-z\\u0B80-\\u0BFF])';
const TA_SEP = '[\\s,.!?;:\'"()\\[\\]-]';
const taWord = (words: string): string => `(?:^|${TA_SEP})(?:${words})${TA_END}`;

const QUESTION_LEAD = new RegExp(
  '^(?:what|whats|what\'s|where|which|how|who|tell|show|remind|do i|did i|am i|is my|are my|can you)\\b' +
    '|^(?:என்னுடைய|என்ன|எது|எங்கே|எங்கு|எப்படி|எவ்வளவு|சொல்லுங்கள்|கூறுங்கள்|தாருங்கள்|உங்கள்|நீங்கள்)' +
    TA_END
);

const FIELD_PATTERNS: Array<{ field: FieldKey; test: RegExp }> = [
  {
    field: 'customer_name',
    test: new RegExp(
      '\\b(?:my name|who am i|the name)\\b|' + taWord('என் பெயர்|எனது பெயர்|என்னுடைய பெயர்|பெயர் என்ன')
    ),
  },
  {
    field: 'pickup_location',
    test: new RegExp(
      '\\b(?:pickup|pick me up|collect from|from where)\\b|' +
        taWord('எங்கிருந்து|எடுக்கும் இடம்|எடுக்க வேண்டிய இடம்')
    ),
  },
  {
    field: 'destination',
    test: new RegExp(
      '\\b(?:destination|deliver|ship to|send to|going to|headed|drop(?:\\s|-|_)?off|to where)\\b|' +
        taWord('எங்கே|சேரும் இடம்|அனுப்ப வேண்டிய இடம்')
    ),
  },
  {
    field: 'vehicle_type',
    test: new RegExp(
      '\\b(?:vehicle|truck|tempo|lorry|container|trailer|van)\\b|' + taWord('வாகனம்')
    ),
  },
  {
    field: 'cargo_weight',
    test: new RegExp(
      '\\b(?:how much cargo|weigh|cargo weigh|weight|\\bkg\\b|tonnes?|tons?)\\b|' +
        taWord('எடை|கிலோ|எவ்வளவு சரக்கு')
    ),
  },
  {
    field: 'cargo_type',
    test: new RegExp(
      '\\b(?:what (?:type of )?cargo|cargo type|type of cargo|what (?:am i|are we) (?:sending|shipping|moving))\\b|' +
        taWord('சரக்கு')
    ),
  },
  { field: 'cargo_dimensions', test: /\b(dimension|cargo size|size of (the |my )?cargo)\b/ },
  {
    field: 'required_date',
    test: new RegExp(
      '\\b(?:required date|delivery date|when.*(?:deliver|ship|pickup|need|required|arrive)|date.*(?:deliver|ship|need))\\b|' +
        taWord('தேதி')
    ),
  },
  {
    field: 'budget',
    test: new RegExp(
      '\\b(?:budget|how much.*(?:cost|price|pay)|price|cost of|quote)\\b|' +
        taWord('ரூபாய்|தொகை|விலை')
    ),
  },
  { field: 'urgency', test: /\b(how urgent|urgency|urgent)\b/ },
  { field: 'booking_intent', test: /\b(book(ing)? intent|did i (ask|want) to book|want to book|going to book)\b/ },
];

const normalizeLine = (line: string): string =>
  line
    .toLowerCase()
    .replace(/[?!.,;:"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A state-correction request is never a memory question ("change my pickup to X" must reach the tool path). */
const TA_UPDATE_STEMS = 'மாற்ற|ஆக்கு|திருத்து|அப்டேட்|புதுப்பி|சேர்|வையுங்கள்|வைங்க';
// Tamil verbs inflect, so stems match with any Tamil-letter continuation
// ("மாற்றுங்கள்", "மாற்றவும்"); the script-aware end keeps longer words safe.
const TA_UPDATE = new RegExp(`(?:^|${TA_SEP})(?:${TA_UPDATE_STEMS})[\\u0B80-\\u0BFF]*${TA_END}`);
const EN_UPDATE = /\b(update|updates|updating|change|changes|changing|set|correct|correction|replace|switch|make it|save as|save it)\b/;
export const hasUpdateIntent = (line: string): boolean => {
  if (typeof line !== 'string') return false;
  const norm = ` ${normalizeLine(line)} `;
  return TA_UPDATE.test(norm) || EN_UPDATE.test(norm);
};

/** Knowledge-seeking phrasing is never a memory question ("vehicles you provide" vs "vehicle I asked for"). */
const KNOWLEDGE_TOPIC = new RegExp(
  '\\b(?:restriction|restrictions|restrict|policy|policies|provide|provides|offer|offers|support|operate|services|service)\\b|' +
    taWord('கட்டுப்பாடு|கொள்கை|சேவை')
);
const isKnowledgePhrasing = (line: string): boolean => {
  const norm = normalizeLine(line);
  return (
    /\b(do you|do u|can you|could you|does .* offer)\b.*\b(provide|provides|offer|offers|have|support|operate)\b/.test(
      norm
    ) ||
    /\bwhat\b.*\bdo you\b.*\b(provide|offer|have|support)\b/.test(norm) ||
    (isQuestionLine(line) && KNOWLEDGE_TOPIC.test(` ${norm} `))
  );
};
const isQuestionLine = (line: string): boolean => {
  const raw = line.trim();
  if (raw.length === 0) return false;
  if (raw.includes('?')) return true;
  return QUESTION_LEAD.test(normalizeLine(raw));
};

/** Split a message into analyzable units (lines, then sentences). */
const splitUnits = (content: string): string[] => {
  const units: string[] = [];
  for (const line of content.split('\n')) {
    for (const part of line.split(/(?<=[.?!])\s+/)) {
      const trimmed = part.trim();
      if (trimmed.length > 0) units.push(trimmed);
    }
  }
  return units;
};

const matchedFields = (line: string): FieldKey[] => {
  const norm = ` ${normalizeLine(line)} `;
  const out: FieldKey[] = [];
  for (const { field, test } of FIELD_PATTERNS) {
    // cargo_type must not steal weight questions ("how much cargo" /
    // "சரக்கு எவ்வளவு" ask weight, not kind).
    if (
      field === 'cargo_type' &&
      (/\b(how much|weigh|weight|\bkg\b|tonnes?|tons?)\b/.test(norm) ||
        new RegExp(taWord('எவ்வளவு|எடை|கிலோ')).test(norm))
    ) {
      continue;
    }
    if (test.test(norm)) out.push(field);
  }
  return out;
};

const textOf = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
};

const withArticle = (value: string): string => {
  if (/^(a|an)\s+/i.test(value)) return value;
  return (/^[aeiou]/i.test(value) ? 'an ' : 'a ') + value;
};

/**
 * True when EVERY unit of the message asks about a state field — used to
 * bypass RAG (state + history suffice; nothing else needs retrieval).
 * Mixed content (statements, knowledge questions, summaries) keeps the
 * normal flow so RAG stays available where needed.
 */
export const isMemoryQuestion = (content: string): boolean => {
  if (typeof content !== 'string') return false;
  const units = splitUnits(content);
  if (units.length === 0) return false;
  return units.every(
    (line) =>
      !isKnowledgePhrasing(line) &&
      !hasUpdateIntent(line) &&
      isQuestionLine(line) &&
      matchedFields(line).length > 0
  );
};

/** Tamil script present → answer memory questions in Tamil. */
export const isTamilContent = (content: string): boolean =>
  typeof content === 'string' && /[\u0B80-\u0BFF]/.test(content);

export type TurnLanguage = 'english' | 'tamil' | 'mixed';

/**
 * Per-turn language of the customer's message. Tamil script decides:
 * script + Latin letters = natural code-mix, script alone = Tamil,
 * otherwise English (the default — never inferred from the operator's
 * locale). Drives both the deterministic greeting and the explicit
 * per-turn LLM language directive, so small models cannot drift.
 */
export const detectTurnLanguage = (content: string): TurnLanguage => {
  if (typeof content !== 'string') return 'english';
  const hasTamil = /[\u0B80-\u0BFF]/.test(content);
  if (!hasTamil) return 'english';
  return /[A-Za-z]/.test(content) ? 'mixed' : 'tamil';
};

/** Explicit per-turn language instruction appended to the system prompt. */
export const languageDirective = (language: TurnLanguage): string => {
  if (language === 'tamil') {
    return 'LANGUAGE: The customer wrote in Tamil. Respond in Tamil only (Tamil script).';
  }
  if (language === 'mixed') {
    return 'LANGUAGE: The customer mixed Tamil and English. Respond naturally with the same Tamil-English mix.';
  }
  return 'LANGUAGE: The customer wrote in English. Respond in English only.';
};

const EN_GREETINGS = new Set([
  'hi',
  'hii',
  'hello',
  'helo',
  'hey',
  'greetings',
  'goodmorning',
  'goodafternoon',
  'goodevening',
]);

const TA_GREETINGS = new Set(['வணக்கம்', 'வணகம்']);

/**
 * True when the WHOLE message is just a hello — no request, no details.
 * ("Hi, I need a truck" carries content and takes the normal turn.)
 * Matched after lowercasing and stripping punctuation/whitespace, with
 * tolerance for stretched spellings ("hiii", "heyyy").
 */
export const isGreetingOnly = (content: string): boolean => {
  if (typeof content !== 'string') return false;
  const stripped = content
    .toLowerCase()
    .replace(/[?!.,;:\s'"]+/g, '');
  if (stripped.length === 0 || stripped.length > 20) return false;
  if (EN_GREETINGS.has(stripped)) return true;
  if (/^hi+$/.test(stripped) || /^he+y+$/.test(stripped) || /^hello+$/.test(stripped)) {
    return true;
  }
  // Tamil greetings have no case; match against the raw stripped text.
  const taStripped = content.replace(/[?!.,;:\s'"]+/g, '');
  return TA_GREETINGS.has(taStripped);
};

/**
 * Deterministic greeting: natural, language-matched, customer-specific,
 * and free of company boilerplate (no invented identity on either side).
 * `name` is the trusted known name (state first, else linked lead) or null.
 */
export const buildGreetingReply = (content: string, name: string | null): string => {
  const cleanName = typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
  if (isTamilContent(content)) {
    return cleanName
      ? `வணக்கம் ${cleanName}! உங்கள் shipment-க்கு எப்படி உதவலாம்?`
      : 'வணக்கம்! உங்கள் shipment-க்கு எப்படி உதவலாம்?';
  }
  return cleanName
    ? `Hello ${cleanName}! How can I help with your shipment today?`
    : 'Hi! How can I help with your shipment today?';
};

const formatAnswer = (field: FieldKey, state: MemoryState, tamil: boolean): string | null => {
  switch (field) {
    case 'customer_name': {
      const v = textOf(state.customer_name);
      if (!v) return null;
      return tamil ? `உங்கள் பெயர் ${v}.` : `Your name is ${v}.`;
    }
    case 'pickup_location': {
      const v = textOf(state.pickup_location);
      if (!v) return null;
      return tamil ? `உங்கள் pickup: ${v}.` : `Your pickup location is ${v}.`;
    }
    case 'destination': {
      const v = textOf(state.destination);
      if (!v) return null;
      return tamil ? `உங்கள் destination: ${v}.` : `Your destination is ${v}.`;
    }
    case 'vehicle_type': {
      const v = textOf(state.vehicle_type);
      if (!v) return null;
      return tamil ? `நீங்கள் கேட்ட வாகனம்: ${v}.` : `You asked for ${withArticle(v)}.`;
    }
    case 'cargo_type': {
      const v = textOf(state.cargo_type);
      if (!v) return null;
      return tamil ? `சரக்கு: ${v}.` : `You're sending ${v}.`;
    }
    case 'cargo_weight': {
      const w = textOf(state.cargo_weight);
      if (!w) return null;
      if (tamil) {
        const cargo = textOf(state.cargo_type);
        return cargo ? `சரக்கு: ${cargo}, எடை: ${w} kg.` : `சரக்கு எடை: ${w} kg.`;
      }
      const cargo = textOf(state.cargo_type);
      return cargo ? `You're sending ${w} kg of ${cargo}.` : `The cargo weighs ${w} kg.`;
    }
    case 'cargo_dimensions': {
      const v = textOf(state.cargo_dimensions);
      if (!v) return null;
      // No concise Tamil template: let the normal LLM turn answer in Tamil.
      return tamil ? null : `The cargo dimensions are ${v}.`;
    }
    case 'required_date': {
      const v = textOf(state.required_date);
      if (!v) return null;
      return tamil ? null : `Your required date is ${v}.`;
    }
    case 'budget': {
      const raw = textOf(state.budget);
      if (!raw) return null;
      const n = Number(String(raw).replace(/[^0-9.]/g, ''));
      const shown = Number.isFinite(n) && String(raw).trim().length > 0 ? n.toLocaleString('en-IN') : raw;
      return tamil ? `உங்கள் budget ₹${shown}.` : `Your budget is \u20B9${shown}.`;
    }
    case 'urgency': {
      const v = textOf(state.urgency);
      if (!v) return null;
      return tamil ? null : `Your shipment urgency is ${v}.`;
    }
    case 'booking_intent': {
      if (state.booking_intent === 'explicit')
        return tamil ? null : `You've asked to book.`;
      if (state.booking_intent === 'not_explicit')
        return tamil ? null : `You haven't asked to book yet.`;
      return null;
    }
    default:
      return null;
  }
};

/**
 * Answer a message composed ONLY of known-field memory questions, one line
 * per field in question order (deduped). Returns null when any line is not
 * a memory question or any asked field is unknown — the normal LLM turn
 * then handles it (follow-ups, mixed statements, full summaries).
 */
export const findMemoryAnswers = (
  content: string,
  state: MemoryState | null | undefined
): string[] | null => {
  if (typeof content !== 'string' || !state) return null;
  const lines = splitUnits(content);
  if (lines.length === 0) return null;
  const tamil = isTamilContent(content);
  const seen = new Set<FieldKey>();
  const answers: string[] = [];
  for (const line of lines) {
    if (isKnowledgePhrasing(line)) return null;
    if (hasUpdateIntent(line)) return null;
    if (!isQuestionLine(line)) return null;
    const all = matchedFields(line);
    if (all.length === 0) return null;
    const fields = all.filter((f) => !seen.has(f));
    if (fields.length === 0) continue; // repeated question: already answered above
    for (const field of fields) {
      const answer = formatAnswer(field, state, tamil);
      if (!answer) return null;
      seen.add(field);
      answers.push(answer);
    }
  }
  return answers.length > 0 ? answers : null;
};
