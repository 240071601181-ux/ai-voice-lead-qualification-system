/**
 * Phase 8 – conversation-scoped calendar endpoints.
 *
 * Thin HTTP mapping only (validation + status mapping). Availability,
 * eligibility, booking, retries, and persistence live in
 * `calendarBookingService` behind the existing provider abstraction.
 *
 * Trust model: conversationId comes from the authenticated route; leadId is
 * resolved from the conversation record. Any client-supplied leadId/callId
 * is ignored — never trusted, never used.
 */
import { Response, NextFunction } from 'express';
import { ConversationRequest } from '../middleware/conversationIdentity';
import {
  checkCalendarAvailability,
  requestCalendarBooking,
} from '../services/calendar/calendarBookingService';
import { enqueueN8nEvent } from '../services/n8n/n8nEmitter';
import { CALENDAR_BOOKING_NOT_CONFIGURED_MESSAGE } from './calendarController';
import { logger } from '../utils/logger';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isNotConfigured = (skipped: string | undefined): boolean =>
  skipped === 'disabled' || skipped === 'no_config';

/** Active or completed conversations may schedule; abandoned may not. */
const isSchedulable = (status: string): boolean => status === 'active' || status === 'completed';

export const getConversationAvailabilityHandler = async (
  req: ConversationRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Ownership pre-checked by requireOwnedConversation: 404 when the
    // conversation is missing or belongs to someone else.
    const conversation = req.conversation!;
    if (!isSchedulable(conversation.status)) {
      return res.status(409).json({
        success: false,
        error: {
          message: `Conversation is ${conversation.status} and cannot schedule meetings`,
          code: 409,
        },
      });
    }
    const { start, end, timezone } = (req.query || {}) as Record<string, unknown>;
    if (!isNonEmptyString(start) || !isNonEmptyString(end)) {
      return res.status(400).json({
        success: false,
        error: { message: 'start and end query parameters are required', code: 400 },
      });
    }
    const outcome = await checkCalendarAvailability({
      start,
      end,
      timezone: isNonEmptyString(timezone) ? timezone : null,
    });
    if (outcome.ok) {
      return res.json({ success: true, data: { available: outcome.available } });
    }
    const statusBySkip: Record<string, number> = {
      invalid_slot: 422,
      no_config: 503,
      disabled: 503,
    };
    const status = (outcome.skipped && statusBySkip[outcome.skipped]) || 502;
    return res.status(status).json({
      success: false,
      error: {
        message: isNotConfigured(outcome.skipped)
          ? CALENDAR_BOOKING_NOT_CONFIGURED_MESSAGE
          : `Availability check failed (${outcome.skipped || 'provider_error'})`,
        code: status,
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const postConversationBookingHandler = async (
  req: ConversationRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Ownership pre-checked by requireOwnedConversation: 404 when the
    // conversation is missing or belongs to someone else.
    const conversation = req.conversation!;
    if (!isSchedulable(conversation.status)) {
      return res.status(409).json({
        success: false,
        error: {
          message: `Conversation is ${conversation.status} and cannot schedule meetings`,
          code: 409,
        },
      });
    }
    const { start, end, timezone, title, summary, notes, description } = req.body || {};
    // Explicit meeting time required: the logistics required_date is NEVER
    // consulted as a meeting time (enforced in calendarSlots/buildCalendarSlot).
    if (!isNonEmptyString(start) || !isNonEmptyString(end)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Explicit start and end datetimes are required', code: 400 },
      });
    }
    // NOTE: req.body.leadId / req.body.callId, when present, are deliberately
    // ignored — the trusted leadId always comes from the conversation record.
    const outcome = await requestCalendarBooking({
      conversationId: conversation.id,
      start,
      end,
      timezone: isNonEmptyString(timezone) ? timezone : null,
      summary: isNonEmptyString(title) ? title : isNonEmptyString(summary) ? summary : null,
      description: isNonEmptyString(notes)
        ? notes
        : isNonEmptyString(description)
          ? description
          : null,
    });
    if (outcome.ok && outcome.booking) {
      // meeting.scheduled fan-out is fire-and-forget: it must not block the
      // booking response. Downstream dedupes via the stable event id.
      const booking = outcome.booking;
      enqueueN8nEvent('meeting.scheduled', {
        leadId: booking.lead_id,
        conversationId: conversation.id,
        meeting: {
          bookingId: booking.id,
          provider: booking.provider,
          start: booking.scheduled_start,
          end: booking.scheduled_end,
          meetUrl: booking.meet_url,
        },
      });
      logger.info('Conversation meeting booked', {
        conversationId: conversation.id,
        leadId: booking.lead_id,
        bookingId: booking.id,
        duplicate: outcome.duplicate || false,
      });
      return res
        .status(outcome.created ? 201 : 200)
        .json({ success: true, data: booking });
    }
    const statusBySkip: Record<string, number> = {
      invalid_slot: 422,
      unavailable: 409,
      tier: 403,
      no_config: 503,
      disabled: 503,
      no_input: 400,
    };
    // no_data here means the conversation has no linked lead (checked first
    // inside the service for conversation bookings) → 422, not 404.
    const status =
      outcome.skipped === 'no_data' ? 422 : (outcome.skipped && statusBySkip[outcome.skipped]) || 502;
    return res.status(status).json({
      success: false,
      error: {
        message: isNotConfigured(outcome.skipped)
          ? CALENDAR_BOOKING_NOT_CONFIGURED_MESSAGE
          : outcome.skipped === 'no_data'
            ? 'Conversation is not linked to a lead and cannot schedule meetings'
            : `Calendar booking not completed (${outcome.skipped || 'provider_error'})`,
        code: status,
      },
      data: outcome.booking || undefined,
    });
  } catch (err) {
    return next(err);
  }
};
