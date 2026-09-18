import { LlmToolCall, LlmToolDefinition } from './llm';
import { ToolResult } from './tools';
import {
  checkCalendarAvailability,
  requestCalendarBooking,
} from '../services/calendar/calendarBookingService';
import {
  TEXT_STATE_FIELDS,
  validateTextStateUpdate,
} from './textStateExtraction';
import {
  createConversationState,
  findConversationStateByConversationId,
  updateConversationStateRecord,
} from '../repositories/conversationStatesRepository';
import { updateLead } from '../repositories/leadRepository';
import { logger } from '../utils/logger';

/**
 * Phase 5 — conversation-anchored tool execution.
 *
 * Extends (never replaces) the existing tool framework in agent/tools.ts:
 * - The legacy Vapi dispatcher (vapiToolController.handleVapiToolCalls) and
 *   the call-anchored executors (updateConversationState, endCall) are
 *   untouched; `endCall` is deliberately NOT exposed to text.
 * - This module adapts the reusable tools for text by injecting a trusted
 *   identity resolved by the backend from the authenticated conversation
 *   record. Anything the LLM supplies as an identity (leadId,
 *   conversationId, callId, userId) is ignored or rejected — never trusted.
 *
 * Security model:
 * - Allowlist of tool names; no generic queryDatabase/executeSQL/runCommand/
 *   fetchURL tool exists or is added here.
 * - Strict argument validation (whitelisted fields, typed values, allowed
 *   enums, SQL/code-injection rejection) via the shared Phase 4 validator.
 * - Parameterized repository calls only; this module builds no SQL.
 * - Raw backend errors are sanitized before reaching the LLM or the client.
 */

/** Trusted execution context — resolved by the backend, never by the LLM. */
export interface TrustedConversationContext {
  conversationId: string;
  leadId: string | null;
}

/** Tools the text assistant may invoke. `endCall` is voice-only. */
export const TEXT_TOOL_NAMES = [
  'updateConversationState',
  'updateLeadInformation',
  'getConversationState',
  'checkCalendarAvailability',
  'scheduleMeeting',
] as const;

export type TextToolName = (typeof TEXT_TOOL_NAMES)[number];

export const isTextToolName = (name: unknown): name is TextToolName =>
  typeof name === 'string' &&
  (TEXT_TOOL_NAMES as readonly string[]).includes(name);

/** Keys that may never be written through tool arguments. */
const FORBIDDEN_STATE_KEYS = new Set([
  'conversationid',
  'conversation_id',
  'leadid',
  'lead_id',
  'userid',
  'user_id',
  'callid',
  'call_id',
  'id',
  'created_at',
  'updated_at',
]);

const FORBIDDEN_LEAD_KEYS = new Set([
  'id',
  'conversationid',
  'conversation_id',
  'leadid',
  'lead_id',
  'userid',
  'user_id',
  'callid',
  'call_id',
  'created_at',
  'updated_at',
]);

/** Lead columns the text tool may update (mirrors the repository whitelist). */
const LEAD_WRITABLE_FIELDS = ['source', 'name', 'phone', 'email', 'status'] as const;

/**
 * Parse LLM-supplied tool arguments. Accepts a JSON string (OpenAI
 * function-call format) or a plain object; everything else is rejected.
 */
export const parseConversationToolArguments = (raw: unknown): Record<string, unknown> | null => {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return {};
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
};

/** Strip PII/DB internals from errors before they reach the LLM or client. */
export const sanitizeToolError = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  // Never leak SQL, connection strings, table/column internals, or stacks.
  if (/select\s|insert\s|update\s|delete\s|from\s+["']?\w+|pg_|postgres|ECONN|relation\s+"/i.test(message)) {
    return 'A database error occurred while executing the tool.';
  }
  return message.slice(0, 300);
};

const stateSummary = (state: Record<string, unknown> | null): string => {
  if (!state) return 'No shipment details have been recorded yet for this conversation.';
  const pick = (v: unknown) => (v === null || v === undefined || v === '' ? 'Not provided' : String(v));
  return [
    `Customer Name: ${pick(state['customer_name'])}`,
    `Pickup Location: ${pick(state['pickup_location'])}`,
    `Destination: ${pick(state['destination'])}`,
    `Vehicle Type: ${pick(state['vehicle_type'])}`,
    `Cargo Type: ${pick(state['cargo_type'])}`,
    `Cargo Weight: ${state['cargo_weight'] ?? 'Not provided'}`,
    `Required Date: ${pick(state['required_date'])}`,
    `Budget: ${pick(state['budget'])}`,
    `Urgency: ${pick(state['urgency'])}`,
  ].join('\n');
};

/**
 * Text adaptation of the state-update tool. Writes to `conversation_states`
 * keyed by the trusted conversationId with deterministic merge semantics:
 * unknown values never erase known fields, unrelated fields are preserved.
 */
export const executeUpdateConversationStateText = async (
  ctx: TrustedConversationContext,
  rawArgs: unknown
): Promise<ToolResult> => {
  const args = parseConversationToolArguments(rawArgs);
  if (!args) {
    return { success: false, errors: ['Tool arguments must be a JSON object'] };
  }
  // Identity supplied by the LLM is ignored — the trusted context wins.
  const updatesRaw = (args['updates'] ?? args) as unknown;
  if (!updatesRaw || typeof updatesRaw !== 'object' || Array.isArray(updatesRaw)) {
    return { success: false, errors: ['updates object is required'] };
  }
  const updates = updatesRaw as Record<string, unknown>;

  // Reject identity-override and arbitrary keys before validation.
  const rejected: string[] = [];
  const unknown: string[] = [];
  for (const key of Object.keys(updates)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_STATE_KEYS.has(lower)) {
      rejected.push(key);
    } else if (!(TEXT_STATE_FIELDS as readonly string[]).includes(key)) {
      unknown.push(key);
    }
  }
  if (rejected.length > 0) {
    return {
      success: false,
      errors: [`Identity/internal fields cannot be modified through this tool: ${rejected.join(', ')}`],
    };
  }
  if (unknown.length > 0) {
    return {
      success: false,
      errors: [`Unknown state field(s): ${unknown.join(', ')}`],
    };
  }

  const validated = validateTextStateUpdate(updates);
  if (Object.keys(validated.sanitized).length === 0) {
    return {
      success: false,
      errors: validated.errors.length > 0 ? validated.errors : ['No valid state fields supplied'],
    };
  }

  try {
    const existing = await findConversationStateByConversationId(ctx.conversationId);
    if (!existing) {
      await createConversationState({
        conversation_id: ctx.conversationId,
        lead_id: ctx.leadId ?? null,
      });
    }
    const persisted = await updateConversationStateRecord(ctx.conversationId, validated.sanitized);
    if (!persisted) {
      return { success: false, errors: ['Conversation state could not be saved'] };
    }
    logger.info('Text tool updateConversationState executed', {
      conversationId: ctx.conversationId,
      leadId: ctx.leadId ?? null,
    });
    return { success: true, message: 'Conversation state updated successfully' };
  } catch (err) {
    logger.error('Text tool updateConversationState failed', {
      conversationId: ctx.conversationId,
      error: (err as Error)?.message,
    });
    return { success: false, errors: [sanitizeToolError(err)] };
  }
};

/**
 * Text adaptation of the lead-update tool. The lead is resolved from the
 * trusted conversation context; any LLM-supplied leadId is ignored.
 */
export const executeUpdateLeadInformationText = async (
  ctx: TrustedConversationContext,
  rawArgs: unknown
): Promise<ToolResult> => {
  if (!ctx.leadId) {
    return { success: false, errors: ['This conversation is not linked to a lead, so lead updates are unavailable'] };
  }
  const args = parseConversationToolArguments(rawArgs);
  if (!args) {
    return { success: false, errors: ['Tool arguments must be a JSON object'] };
  }
  const updatesRaw = (args['updates'] ?? args) as unknown;
  if (!updatesRaw || typeof updatesRaw !== 'object' || Array.isArray(updatesRaw)) {
    return { success: false, errors: ['updates object is required'] };
  }
  const updates = updatesRaw as Record<string, unknown>;

  const rejected: string[] = [];
  const unknown: string[] = [];
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(updates)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_LEAD_KEYS.has(lower)) {
      rejected.push(key);
      continue;
    }
    if (!(LEAD_WRITABLE_FIELDS as readonly string[]).includes(key)) {
      unknown.push(key);
      continue;
    }
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 500) {
      return { success: false, errors: [`${key} must be a non-empty string (max 500 characters)`] };
    }
    if (/(__proto__|constructor\s*\[|process\.env|require\s*\()/.test(value)) {
      return { success: false, errors: [`${key} contains a forbidden pattern`] };
    }
    sanitized[key] = value.trim();
  }
  if (rejected.length > 0) {
    return {
      success: false,
      errors: [`Protected field(s) cannot be modified: ${rejected.join(', ')}`],
    };
  }
  if (unknown.length > 0) {
    return { success: false, errors: [`Unknown lead field(s): ${unknown.join(', ')}`] };
  }
  if (Object.keys(sanitized).length === 0) {
    return { success: false, errors: ['No valid lead fields supplied'] };
  }

  try {
    // Trusted lead only — the LLM can never select another lead.
    const updated = await updateLead(ctx.leadId, sanitized);
    if (!updated) {
      return { success: false, errors: ['Linked lead not found'] };
    }
    logger.info('Text tool updateLeadInformation executed', {
      conversationId: ctx.conversationId,
      leadId: ctx.leadId,
    });
    return { success: true, message: 'Lead information updated successfully' };
  } catch (err) {
    logger.error('Text tool updateLeadInformation failed', {
      conversationId: ctx.conversationId,
      error: (err as Error)?.message,
    });
    return { success: false, errors: [sanitizeToolError(err)] };
  }
};

/**
 * Read-only state lookup so the assistant answers "what's my current
 * pickup/destination?" from stored data instead of hallucinating.
 */
export const executeGetConversationStateText = async (
  ctx: TrustedConversationContext
): Promise<ToolResult> => {
  try {
    const record = await findConversationStateByConversationId(ctx.conversationId);
    return {
      success: true,
      message: stateSummary(record as unknown as Record<string, unknown> | null),
    };
  } catch (err) {
    logger.error('Text tool getConversationState failed', {
      conversationId: ctx.conversationId,
      error: (err as Error)?.message,
    });
    return { success: false, errors: [sanitizeToolError(err)] };
  }
};

/** Argument keys that may never appear in calendar tool calls. */
const FORBIDDEN_CALENDAR_KEYS = new Set([
  'leadid',
  'lead_id',
  'conversationid',
  'conversation_id',
  'callid',
  'call_id',
  'userid',
  'user_id',
  'required_date',
  'requireddate',
  'provider',
  'calendarid',
  'calendar_id',
]);

const CALENDAR_AVAILABILITY_FIELDS = ['start', 'end', 'timezone'] as const;
const CALENDAR_BOOKING_FIELDS = [
  'start',
  'end',
  'timezone',
  'title',
  'summary',
  'notes',
  'description',
] as const;

const nonEmptyString = (value: unknown, max = 500): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return undefined;
  return trimmed;
};

/**
 * Check availability for an explicitly requested slot. Read-only: never
 * books. The logistics required_date is never consulted as a meeting time —
 * only explicit start/end arguments are accepted.
 */
export const executeCheckCalendarAvailabilityText = async (
  ctx: TrustedConversationContext,
  rawArgs: unknown
): Promise<ToolResult> => {
  const args = parseConversationToolArguments(rawArgs);
  if (!args) {
    return { success: false, errors: ['Tool arguments must be a JSON object'] };
  }
  for (const key of Object.keys(args)) {
    if (FORBIDDEN_CALENDAR_KEYS.has(key.toLowerCase())) {
      return { success: false, errors: [`${key} cannot be supplied to this tool`] };
    }
    if (!(CALENDAR_AVAILABILITY_FIELDS as readonly string[]).includes(key)) {
      return { success: false, errors: [`Unknown field: ${key}`] };
    }
  }
  const start = nonEmptyString(args['start']);
  const end = nonEmptyString(args['end']);
  if (!start || !end) {
    return {
      success: false,
      errors: ['Explicit start and end datetimes are required (ask the user for a time)'],
    };
  }
  try {
    const outcome = await checkCalendarAvailability({
      start,
      end,
      timezone: nonEmptyString(args['timezone'], 64) ?? null,
    });
    if (outcome.ok) {
      return {
        success: true,
        message: outcome.available
          ? 'The requested slot is available.'
          : 'The requested slot is not available. Ask the user for another time.',
      };
    }
    return {
      success: false,
      errors: [`Availability check not completed (${outcome.skipped || 'provider_error'})`],
    };
  } catch (err) {
    logger.error('Text tool checkCalendarAvailability failed', {
      conversationId: ctx.conversationId,
      error: (err as Error)?.message,
    });
    return { success: false, errors: [sanitizeToolError(err)] };
  }
};

/**
 * Book an explicitly requested meeting slot for the trusted conversation.
 * Requires user-provided start/end (explicit confirmation upstream); never
 * infers the time from required_date or any other slot.
 */
export const executeScheduleMeetingText = async (
  ctx: TrustedConversationContext,
  rawArgs: unknown
): Promise<ToolResult> => {
  if (!ctx.leadId) {
    return { success: false, errors: ['This conversation is not linked to a lead, so booking is unavailable'] };
  }
  const args = parseConversationToolArguments(rawArgs);
  if (!args) {
    return { success: false, errors: ['Tool arguments must be a JSON object'] };
  }
  for (const key of Object.keys(args)) {
    if (FORBIDDEN_CALENDAR_KEYS.has(key.toLowerCase())) {
      return { success: false, errors: [`${key} cannot be supplied to this tool`] };
    }
    if (!(CALENDAR_BOOKING_FIELDS as readonly string[]).includes(key)) {
      return { success: false, errors: [`Unknown field: ${key}`] };
    }
  }
  const start = nonEmptyString(args['start']);
  const end = nonEmptyString(args['end']);
  if (!start || !end) {
    return {
      success: false,
      errors: ['Explicit start and end datetimes are required (ask the user for a time)'],
    };
  }
  try {
    const outcome = await requestCalendarBooking({
      conversationId: ctx.conversationId,
      start,
      end,
      timezone: nonEmptyString(args['timezone'], 64) ?? null,
      summary:
        nonEmptyString(args['title']) ?? nonEmptyString(args['summary']) ?? null,
      description:
        nonEmptyString(args['notes'], 2000) ?? nonEmptyString(args['description'], 2000) ?? null,
    });
    if (outcome.ok && outcome.booking) {
      const parts = [
        'Meeting scheduled successfully',
        `booking ${outcome.booking.id}`,
        `${outcome.booking.scheduled_start} to ${outcome.booking.scheduled_end} (${outcome.booking.timezone})`,
      ];
      if (outcome.booking.meet_url) parts.push(`Join: ${outcome.booking.meet_url}`);
      if (outcome.duplicate) parts.push('(existing booking reused)');
      logger.info('Text tool scheduleMeeting executed', {
        conversationId: ctx.conversationId,
        leadId: ctx.leadId ?? null,
      });
      return { success: true, message: parts.join('. ') };
    }
    return {
      success: false,
      errors: [`Meeting could not be scheduled (${outcome.skipped || 'provider_error'})`],
    };
  } catch (err) {
    logger.error('Text tool scheduleMeeting failed', {
      conversationId: ctx.conversationId,
      error: (err as Error)?.message,
    });
    return { success: false, errors: [sanitizeToolError(err)] };
  }
};

/**
 * Strict JSON-text fallback for models that emit a tool call as assistant
 * content instead of the structured `tool_calls` field (observed with local
 * llama3.2 via Ollama: `{"name":"updateConversationState","parameters":{...}}`
 * with no `tool_calls` on the message).
 *
 * Recognition is deliberately narrow — ONLY the exact internal tool-call
 * SHAPE qualifies:
 * - the ENTIRE trimmed content (optionally wrapped in one ```json fence)
 *   parses as a single plain JSON object; embedded JSON stays plain text.
 * - top-level keys are limited to `name` + (`parameters` | `arguments`) and
 *   an optional string `id`. Any other key disqualifies it.
 * - `name` is a non-empty string; the arguments value is a plain object.
 *
 * Shape recognition is NOT execution permission: the returned call always
 * flows through dispatchConversationTool, which enforces the text-tool
 * allowlist (unknown tools are rejected there), validates arguments, and
 * injects the trusted context. Routing unknown names to the dispatcher —
 * instead of dropping them — lets the model receive the rejection and
 * answer naturally instead of leaking raw JSON.
 *
 * Everything else — malformed JSON, arrays, arbitrary customer JSON, extra
 * keys — returns undefined. Malformed tool-shaped content is handled by
 * looksLikeJsonToolCall (suppressed, never executed). Never throws.
 */
export const extractJsonToolCallsFromContent = (content: unknown): LlmToolCall[] | undefined => {
  if (typeof content !== 'string') return undefined;
  let text = content.trim();
  if (text.length === 0 || text.length > 8000) return undefined;
  // Tolerate a single surrounding markdown code fence; nothing else.
  const fence = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fence) text = fence[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  const hasArgs = 'parameters' in obj || 'arguments' in obj;
  if (!('name' in obj) || !hasArgs) return undefined;
  const allowed = new Set(['name', 'parameters', 'arguments', 'id']);
  if (!keys.every((k) => allowed.has(k))) return undefined;
  // Name allowlisting is enforced at execution (dispatchConversationTool),
  // not here, so unknown names are properly rejected instead of leaked.
  if (typeof obj['name'] !== 'string' || (obj['name'] as string).trim().length === 0) return undefined;
  if (obj['id'] !== undefined && typeof obj['id'] !== 'string') return undefined;
  const rawArgs = ('parameters' in obj ? obj['parameters'] : obj['arguments']) as unknown;
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return undefined;
  const id =
    typeof obj['id'] === 'string' && obj['id'].trim().length > 0
      ? obj['id'].trim().slice(0, 64)
      : 'json_fallback_0';
  return [
    {
      id,
      type: 'function',
      function: {
        name: obj['name'] as string,
        arguments: JSON.stringify(rawArgs),
      },
    },
  ];
};

/** True when assistant content is actually a strict tool-call JSON payload. */
export const isJsonToolCallContent = (content: unknown): boolean =>
  extractJsonToolCallsFromContent(content) !== undefined;

/**
 * Probable tool-call leak that FAILED strict parsing (e.g. truncated
 * mid-object by a generation limit: `{"name":"updateConversationState",
 * "parameters":{"updates":{...}}` with missing closing braces).
 *
 * True only when the content carries the distinctive tool-call key combo
 * (`"name"` plus a `"parameters"`/`"arguments"` key) yet is not a valid
 * strict payload. Such content must never execute (arguments are
 * unknowable) and never render (it is internal machinery, not customer
 * language). Ordinary malformed or customer JSON lacks this key combo and
 * stays normal text.
 */
export const looksLikeJsonToolCall = (content: unknown): boolean => {
  if (typeof content !== 'string') return false;
  const text = content.trim();
  if (text.length === 0 || text.length > 8000) return false;
  if (extractJsonToolCallsFromContent(text) !== undefined) return false;
  if (!text.includes('"name"')) return false;
  return text.includes('"parameters"') || text.includes('"arguments"');
};

export interface DispatchedToolOutcome {
  name: string;
  success: boolean;
  /** Safe, customer-suitable result text forwarded to the LLM. */
  resultText: string;
}

/**
 * Validate the tool name against the text allowlist, validate arguments,
 * inject the trusted conversation context, and execute. Unknown tools are
 * rejected — never executed, never proxied.
 */
export const dispatchConversationTool = async (
  ctx: TrustedConversationContext,
  name: unknown,
  rawArgs: unknown
): Promise<DispatchedToolOutcome> => {
  const startedAt = Date.now();
  const finish = (resultText: string, success: boolean): DispatchedToolOutcome => {
    logger.info('Text tool execution finished', {
      conversationId: ctx.conversationId,
      leadId: ctx.leadId ?? null,
      tool: String(name),
      success,
      durationMs: Date.now() - startedAt,
    });
    return { name: String(name), success, resultText };
  };

  if (!isTextToolName(name)) {
    return finish(
      `Tool '${String(name)}' is not available in text conversations. Continue without it.`,
      false
    );
  }

  try {
    let result: ToolResult;
    if (name === 'updateConversationState') {
      result = await executeUpdateConversationStateText(ctx, rawArgs);
    } else if (name === 'updateLeadInformation') {
      result = await executeUpdateLeadInformationText(ctx, rawArgs);
    } else if (name === 'checkCalendarAvailability') {
      result = await executeCheckCalendarAvailabilityText(ctx, rawArgs);
    } else if (name === 'scheduleMeeting') {
      result = await executeScheduleMeetingText(ctx, rawArgs);
    } else {
      result = await executeGetConversationStateText(ctx);
    }
    if (result.success) {
      return finish(result.message || 'Tool executed successfully', true);
    }
    const safe = (result.errors ?? ['Tool execution failed']).join('; ').slice(0, 500);
    return finish(
      `Tool '${name}' could not be completed: ${safe}. Explain this limitation naturally without exposing internals.`,
      false
    );
  } catch (err) {
    return finish(
      `Tool '${name}' could not be completed: ${sanitizeToolError(err)}. Explain this limitation naturally without exposing internals.`,
      false
    );
  }
};

/**
 * Function definitions advertised to the LLM for text turns. Reuses the
 * existing tool semantics; identity fields are intentionally absent from
 * every schema because the backend injects them.
 */
export const getTextToolDefinitions = (): LlmToolDefinition[] => [
  {
    type: 'function',
    function: {
      name: 'updateConversationState',
      description:
        'Save confirmed shipment details (pickup, destination, vehicle, cargo, budget, urgency). Only whitelisted fields are accepted.',
      parameters: {
        type: 'object',
        properties: {
          updates: {
            type: 'object',
            description: 'Shipment slots to save. Unknown or identity fields are rejected.',
            properties: {
              customer_name: { type: 'string' },
              pickup_location: { type: 'string' },
              destination: { type: 'string' },
              vehicle_type: { type: 'string' },
              cargo_type: { type: 'string' },
              cargo_weight: { type: 'number' },
              cargo_dimensions: { type: 'string' },
              required_date: { type: 'string' },
              budget: { type: 'number' },
              urgency: { type: 'string' },
              booking_intent: { type: 'string', enum: ['explicit', 'not_explicit', 'unknown'] },
              additional_requirements: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateLeadInformation',
      description:
        'Update the contact details of the lead linked to this conversation (name, phone, email, source, status).',
      parameters: {
        type: 'object',
        properties: {
          updates: {
            type: 'object',
            description: 'Contact fields to update.',
            properties: {
              name: { type: 'string' },
              phone: { type: 'string' },
              email: { type: 'string' },
              source: { type: 'string' },
              status: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getConversationState',
      description:
        'Read the shipment details recorded so far in this conversation. Call this when the customer asks what you have on file.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkCalendarAvailability',
      description:
        'Check calendar availability for an explicitly user-provided time slot. Read-only: never books. Only call with a concrete start/end the user gave; never infer a time from required_date or any other field.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'ISO-8601 meeting start provided by the user' },
          end: { type: 'string', description: 'ISO-8601 meeting end provided by the user' },
          timezone: { type: 'string', description: 'IANA timezone, e.g. Asia/Kolkata' },
        },
        required: ['start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scheduleMeeting',
      description:
        'Book a meeting for an explicitly user-confirmed time slot. Only call after the user provided a concrete date/time (ask first if missing). Never infer the time from required_date. Requires explicit start and end.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'ISO-8601 meeting start confirmed by the user' },
          end: { type: 'string', description: 'ISO-8601 meeting end confirmed by the user' },
          timezone: { type: 'string', description: 'IANA timezone, e.g. Asia/Kolkata' },
          title: { type: 'string', description: 'Meeting title' },
          notes: { type: 'string', description: 'Optional meeting notes' },
        },
        required: ['start', 'end'],
      },
    },
  },
];
