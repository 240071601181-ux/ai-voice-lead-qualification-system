/**
 * Phase 12 – calendar booking orchestrator (all business logic lives here).
 *
 * Books explicit requested meeting slots after eligibility is determined:
 * - a persisted qualification with an eligible tier gates call-linked
 *   bookings (COLD never books); explicit internal requests without a
 *   qualification are themselves the business-logic determination.
 * - the slot must be explicitly requested (start/end/timezone); the
 *   logistics required_date is never consulted as a meeting time.
 *
 * Hard guarantees:
 * - NEVER in the real-time path: the internal endpoint awaits this with
 *   bounded timeouts/retries, but no Vapi/LLM flow ever calls it.
 * - NEVER throws to callers: failures resolve as `{ ok:false }` outcomes
 *   with a persisted `failed` row.
 * - Independent from CRM/n8n/WhatsApp: no cross-imports.
 * - NEVER logs or persists OAuth tokens, secrets, codes, or credentials.
 * - Idempotent: stable booking key per provider+anchor; same slot returns
 *   the stored event; changed slots get a deterministic `:n` suffix.
 */
import { LeadService } from '../leadService';
import { findCallById } from '../../repositories/callRepository';
import { findConversationById } from '../../repositories/conversationRepository';
import { findConversationStateByConversationId } from '../../repositories/conversationStatesRepository';
import { getStateByCallId } from '../conversationStateService';
import {
  findQualificationByCallId,
  findQualificationByConversationId,
} from '../../repositories/qualificationRepository';
import {
  buildCalendarBookingKey,
  getCalendarProvider,
  hashCalendarSlot,
  CalendarSlot
} from './calendarProvider';
import { buildCalendarSlot, InvalidSlotError } from './calendarSlots';
import { withCrmRetry } from '../crm/crmRetry';
import {
  findBookingByKey,
  markBookingBooked,
  markBookingFailed,
  markBookingSkipped,
  upsertBookingAttempt,
  countBookings,
  countFailedBookings,
  listBookings,
  CalendarBookingListItem,
  CalendarBookingRow
} from '../../repositories/calendarBookingRepository';
import { getCalendarConfig, isCalendarEnabled } from '../../config';
import { logger } from '../../utils/logger';

export interface CalendarBookingInput {
  leadId?: string | null;
  callId?: string | null;
  /** Phase 8: text-conversation anchor (trusted conversationId, never a fake callId). */
  conversationId?: string | null;
  /** Explicit requested slot (ISO datetimes + IANA timezone). Required. */
  start?: string | null;
  end?: string | null;
  timezone?: string | null;
  summary?: string | null;
  description?: string | null;
}

export interface CalendarBookingOutcome {
  ok: boolean;
  created?: boolean;
  duplicate?: boolean;
  booking?: CalendarBookingRow | null;
  skipped?:
    | 'disabled'
    | 'no_input'
    | 'no_data'
    | 'no_config'
    | 'invalid_slot'
    | 'unavailable'
    | 'tier';
}

/** Remove OAuth tokens, secrets, codes, and credentials before logging/persisting. */
export const sanitizeCalendarErrorMessage = (err: any): string => {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown calendar error');
  const cfg = getCalendarConfigSafe();
  let clean = raw;
  for (const secret of [cfg.clientSecret, cfg.refreshToken]) {
    if (secret && secret.length > 0) {
      clean = clean.split(secret).join('[REDACTED]');
    }
  }
  clean = clean
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/g, 'Bearer [REDACTED]')
    .replace(/refresh_token\s*[:=]\s*['"]?[^'"\s,}]+['"]?/gi, 'refresh_token=[REDACTED]')
    .replace(/access_token\s*[:=]\s*['"]?[^'"\s,}]+['"]?/gi, 'access_token=[REDACTED]')
    .replace(/client_secret\s*[:=]\s*['"]?[^'"\s,}]+['"]?/gi, 'client_secret=[REDACTED]')
    .replace(/authorization[_\s-]*code\s*[:=]\s*['"]?[^'"\s,}]+['"]?/gi, 'authorization_code=[REDACTED]')
    .replace(/api[_-]?key\s*[:=]\s*['"]?[^'"\s,}]+['"]?/gi, 'api_key=[REDACTED]');
  if (clean.length > 500) clean = clean.slice(0, 500);
  return clean;
};

const getCalendarConfigSafe = (): { clientSecret: string; refreshToken: string } => {
  try {
    const cfg = getCalendarConfig();
    return { clientSecret: cfg.clientSecret || '', refreshToken: cfg.refreshToken || '' };
  } catch {
    return { clientSecret: '', refreshToken: '' };
  }
};

const leadService = new LeadService();

const textOrUndefined = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Explicit booking request. Awaited by the thin internal endpoint with
 * bounded retries/timeouts. Resolves (never rejects) with an outcome.
 */
export const requestCalendarBooking = async (
  input: CalendarBookingInput
): Promise<CalendarBookingOutcome> => {
  if (!isCalendarEnabled()) return { ok: false, skipped: 'disabled' };
  const callId = input.callId || null;
  const conversationId = input.conversationId || null;
  const inputLeadId = input.leadId || null;
  if (!callId && !inputLeadId && !conversationId) {
    logger.warn('Calendar booking skipped: no callId, leadId, or conversationId provided');
    return { ok: false, skipped: 'no_input' };
  }

  const cfg = getCalendarConfig();
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    logger.warn('Calendar booking skipped: Google OAuth credentials not configured');
    return { ok: false, skipped: 'no_config' };
  }

  // Explicit slot required: required_date is logistics data, not a meeting time.
  let slot: CalendarSlot;
  try {
    slot = buildCalendarSlot(
      { start: input.start, end: input.end, timezone: input.timezone },
      {
        defaultTimezone: cfg.timezone,
        minDurationMin: cfg.minDurationMin,
        maxDurationMin: cfg.maxDurationMin
      }
    );
  } catch (err) {
    if (err instanceof InvalidSlotError) {
      return { ok: false, skipped: 'invalid_slot' };
    }
    throw err;
  }

  try {
    // Reuse existing Phase 1–11 readers only; no duplicated business logic.
    // Conversation path resolves the trusted lead from the conversation
    // record (caller-supplied leadId is ignored); the legacy path reads by
    // callId exactly as before.
    const [call, conversation, state, qualification] = await Promise.all([
      callId ? findCallById(callId) : Promise.resolve(null),
      conversationId ? findConversationById(conversationId) : Promise.resolve(null),
      conversationId
        ? findConversationStateByConversationId(conversationId)
        : callId
          ? getStateByCallId(callId)
          : Promise.resolve(null),
      conversationId
        ? findQualificationByConversationId(conversationId)
        : callId
          ? findQualificationByCallId(callId)
          : Promise.resolve(null)
    ]);
    if (conversationId && !conversation) {
      logger.warn('Calendar booking skipped: conversation not found', { conversationId });
      return { ok: false, skipped: 'no_data' };
    }
    // Phase 8: a lead-less conversation can never book — the trusted leadId
    // comes from the conversation record alone. Do not book, do not infer.
    if (conversationId && !conversation?.lead_id) {
      logger.warn('Calendar booking skipped: conversation is not linked to a lead', {
        conversationId,
      });
      return { ok: false, skipped: 'no_data' };
    }
    const leadId = conversationId
      ? conversation?.lead_id || null
      : inputLeadId || state?.lead_id || call?.lead_id || qualification?.lead_id || null;
    const lead = leadId ? await leadService.getLead(leadId) : null;

    if (!lead && !call && !state && !qualification && !conversation) {
      logger.warn('Calendar booking skipped: no lead/call/state/qualification/conversation data found', {
        leadId,
        callId,
        conversationId
      });
      return { ok: false, skipped: 'no_data' };
    }

    // Eligibility: a persisted qualification gates tier; without one, the
    // explicit internal request itself is the business-logic determination.
    if (qualification && !cfg.autoBookTiers.includes(qualification.tier)) {
      const anchor = conversationId ? `conv:${conversationId}` : callId || (leadId as string);
      const providerName = safeProviderName();
      const row = await upsertBookingAttempt({
        booking_key: buildCalendarBookingKey(providerName, anchor),
        lead_id: leadId,
        call_id: callId,
        conversation_id: conversationId,
        qualification_id: qualification.id,
        provider: providerName,
        calendar_id: cfg.calendarId,
        scheduled_start: slot.start,
        scheduled_end: slot.end,
        timezone: slot.timezone,
        slot_hash: hashCalendarSlot(slot)
      });
      await markBookingSkipped(row.id, 'skipped_tier');
      logger.info('Calendar booking skipped: tier not eligible', {
        tier: qualification.tier,
        leadId,
        callId,
        conversationId
      });
      return { ok: false, skipped: 'tier', booking: row };
    }

    const provider = getCalendarProvider();
    const anchor = conversationId
      ? `conv:${conversationId}`
      : call?.id || (state as any)?.call_id || qualification?.call_id || (leadId as string);
    const slotHash = hashCalendarSlot(slot);

    // Dedupe: same key + same slot already booked → return stored meeting.
    const baseKey = buildCalendarBookingKey(provider.name, anchor);
    const previous = await findBookingByKey(baseKey);
    if (previous && previous.status === 'booked' && previous.slot_hash === slotHash) {
      logger.info('Calendar booking deduplicated: returning existing meeting', {
        leadId,
        callId,
        conversationId
      });
      return { ok: true, duplicate: true, booking: previous };
    }
    // Changed slot for the same anchor → deterministic new occurrence.
    const discriminator = previous && previous.status !== 'failed' ? 2 : 1;
    const bookingKey =
      discriminator > 1 ? buildCalendarBookingKey(provider.name, anchor, discriminator) : baseKey;
    const row = await upsertBookingAttempt({
      booking_key: bookingKey,
      lead_id: leadId,
      call_id: callId,
      conversation_id: conversationId,
      qualification_id: qualification?.id || null,
      provider: provider.name,
      calendar_id: cfg.calendarId,
      scheduled_start: slot.start,
      scheduled_end: slot.end,
      timezone: slot.timezone,
      slot_hash: slotHash
    });

    // Availability check immediately before insert.
    const availability = await withCrmRetry(
      () =>
        provider.checkAvailability({
          calendarId: cfg.calendarId,
          slot,
          timeoutMs: cfg.timeoutMs
        }),
      { maxRetries: cfg.maxRetries, baseDelayMs: cfg.baseDelayMs }
    );
    if (!availability.available) {
      await markBookingSkipped(row.id, 'skipped_unavailable');
      logger.info('Calendar booking skipped: slot unavailable', { leadId, callId, conversationId });
      return { ok: false, skipped: 'unavailable', booking: row };
    }

    const leadName = textOrUndefined(lead?.name) || textOrUndefined(state?.customer_name) || 'Lead';
    const origin = textOrUndefined(state?.pickup_location);
    const destination = textOrUndefined(state?.destination);
    const route = origin && destination ? `${origin} → ${destination}` : origin || destination;
    const summary =
      textOrUndefined(input.summary) || `Meeting with ${leadName}${route ? ` (${route})` : ''}`;
    const description =
      textOrUndefined(input.description) ||
      [
        `Lead: ${leadName}`,
        route ? `Route: ${route}` : null,
        qualification ? `Qualification: ${qualification.tier} (${qualification.score})` : null
      ]
        .filter(Boolean)
        .join('\n');

    try {
      const result = await withCrmRetry(
        () =>
          provider.createEvent({
            calendarId: cfg.calendarId,
            summary,
            description,
            attendees: lead?.email ? [{ email: lead.email, displayName: leadName }] : undefined,
            slot,
            idempotencyKey: bookingKey,
            timeoutMs: cfg.timeoutMs
          }),
        { maxRetries: cfg.maxRetries, baseDelayMs: cfg.baseDelayMs }
      );
      const booked = await markBookingBooked(row.id, result.externalEventId, result.meetUrl);
      logger.info('Calendar booking completed', { leadId, callId, conversationId, meetUrl: result.meetUrl });
      return { ok: true, created: true, booking: booked };
    } catch (insertErr: any) {
      // Provider-reported duplicate: resolve to the stored meeting when present.
      if (insertErr?.duplicate) {
        const existing = await findBookingByKey(bookingKey);
        if (existing && existing.status === 'booked') {
          return { ok: true, duplicate: true, booking: existing };
        }
      }
      throw insertErr;
    }
  } catch (err: any) {
    const message = sanitizeCalendarErrorMessage(err);
    try {
      const providerName = safeProviderName();
      const anchor = conversationId ? `conv:${conversationId}` : callId || inputLeadId || 'unknown';
      const failedRow = await upsertBookingAttempt({
        booking_key: buildCalendarBookingKey(providerName, anchor),
        lead_id: inputLeadId,
        call_id: callId,
        conversation_id: conversationId,
        qualification_id: null,
        provider: providerName,
        calendar_id: getCalendarConfig().calendarId,
        scheduled_start: null,
        scheduled_end: null,
        timezone: null,
        slot_hash: 'error'
      });
      await markBookingFailed(failedRow.id, message);
    } catch (persistErr: any) {
      logger.error('Calendar failure could not be persisted', {
        error: sanitizeCalendarErrorMessage(persistErr)
      });
    }
    logger.error('Calendar booking failed', {
      error: message,
      leadId: inputLeadId,
      callId,
      conversationId
    });
    return { ok: false };
  }
};

/**
 * Standalone availability check for an explicit slot. Never rejects.
 */
export const checkCalendarAvailability = async (input: {
  start?: string | null;
  end?: string | null;
  timezone?: string | null;
}): Promise<{ ok: boolean; available?: boolean; skipped?: 'disabled' | 'no_config' | 'invalid_slot' }> => {
  if (!isCalendarEnabled()) return { ok: false, skipped: 'disabled' };
  const cfg = getCalendarConfig();
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    return { ok: false, skipped: 'no_config' };
  }
  let slot: CalendarSlot;
  try {
    slot = buildCalendarSlot(
      { start: input.start, end: input.end, timezone: input.timezone },
      {
        defaultTimezone: cfg.timezone,
        minDurationMin: cfg.minDurationMin,
        maxDurationMin: cfg.maxDurationMin
      }
    );
  } catch (err) {
    if (err instanceof InvalidSlotError) return { ok: false, skipped: 'invalid_slot' };
    throw err;
  }
  try {
    const provider = getCalendarProvider();
    const result = await withCrmRetry(
      () =>
        provider.checkAvailability({
          calendarId: cfg.calendarId,
          slot,
          timeoutMs: cfg.timeoutMs
        }),
      { maxRetries: cfg.maxRetries, baseDelayMs: cfg.baseDelayMs }
    );
    return { ok: true, available: result.available };
  } catch (err: any) {
    logger.error('Calendar availability check failed', {
      error: sanitizeCalendarErrorMessage(err)
    });
    return { ok: false };
  }
};

const safeProviderName = (): string => {
  try {
    return getCalendarProvider().name;
  } catch {
    return getCalendarConfig().provider || 'google';
  }
};

export interface ListCalendarBookingsResult {
  bookings: CalendarBookingListItem[];
  total: number;
  failedCount: number;
  page: number;
  limit: number;
}

export const DEFAULT_BOOKINGS_LIMIT = 20;
export const MAX_BOOKINGS_LIMIT = 100;

/**
 * Paginated booking inventory with real totals. The Calendar page table
 * renders these rows verbatim (no demo meetings). Meet URLs / external
 * event ids are included only as stored — never invented.
 */
export const listCalendarBookings = async (args: {
  page?: unknown;
  limit?: unknown;
}): Promise<ListCalendarBookingsResult> => {
  const page = args.page === undefined ? 1 : Number(args.page);
  const limit = args.limit === undefined ? DEFAULT_BOOKINGS_LIMIT : Number(args.limit);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error('page must be a positive integer');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BOOKINGS_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_BOOKINGS_LIMIT}`);
  }
  const [bookings, total, failedCount] = await Promise.all([
    listBookings({ limit, offset: (page - 1) * limit }),
    countBookings(),
    countFailedBookings()
  ]);
  return { bookings, total, failedCount, page, limit };
};
