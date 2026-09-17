import { LlmToolDefinition } from './llm';
import { ToolResult } from './tools';
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
];
