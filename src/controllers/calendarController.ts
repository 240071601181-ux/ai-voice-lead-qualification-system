/**
 * Phase 12 – thin Calendar controller.
 *
 * Validation + HTTP mapping only. All orchestration, eligibility,
 * availability, booking, retries, and persistence live in
 * `calendarBookingService`. Never called from the Vapi/LLM path.
 */
import { Request, Response, NextFunction } from 'express';
import {
  checkCalendarAvailability,
  listCalendarBookings,
  requestCalendarBooking
} from '../services/calendar/calendarBookingService';
import { getSyncStatus, runCalendarSync } from '../services/calendar/calendarSyncService';
import { getCalendarDiagnostics } from '../services/calendar/calendarDiagnosticsService';
import { findBookingById } from '../repositories/calendarBookingRepository';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Truthful user-facing signal for unavailable booking: calendar disabled
 * or provider credentials missing. Never faked as success.
 */
export const CALENDAR_BOOKING_NOT_CONFIGURED_MESSAGE =
  'Calendar booking is not configured. Connect Google Calendar to create a meeting.';

const isNotConfigured = (skipped: string | undefined): boolean =>
  skipped === 'disabled' || skipped === 'no_config';

export const createBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { leadId, callId, start, end, timezone, summary, description } = req.body || {};
    if (!isNonEmptyString(leadId) && !isNonEmptyString(callId)) {
      return res.status(400).json({
        success: false,
        error: { message: 'leadId or callId is required', code: 400 }
      });
    }
    if (!isNonEmptyString(start) || !isNonEmptyString(end)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Explicit start and end datetimes are required', code: 400 }
      });
    }
    const outcome = await requestCalendarBooking({
      leadId: isNonEmptyString(leadId) ? leadId : null,
      callId: isNonEmptyString(callId) ? callId : null,
      start,
      end,
      timezone: isNonEmptyString(timezone) ? timezone : null,
      summary: isNonEmptyString(summary) ? summary : null,
      description: isNonEmptyString(description) ? description : null
    });
    if (outcome.ok && outcome.booking) {
      return res
        .status(outcome.created ? 201 : 200)
        .json({ success: true, data: outcome.booking });
    }
    const statusBySkip: Record<string, number> = {
      invalid_slot: 422,
      unavailable: 409,
      tier: 403,
      no_data: 404,
      no_config: 503,
      disabled: 503,
      no_input: 400
    };
    const status = (outcome.skipped && statusBySkip[outcome.skipped]) || 502;
    return res.status(status).json({
      success: false,
      error: {
        message: isNotConfigured(outcome.skipped)
          ? CALENDAR_BOOKING_NOT_CONFIGURED_MESSAGE
          : `Calendar booking not completed (${outcome.skipped || 'provider_error'})`,
        code: status
      },
      data: outcome.booking || undefined
    });
  } catch (err) {
    next(err);
  }
};

export const getBooking = async (req: Request, res: Response, next: NextFunction) => {

  try {
    const booking = await findBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: { message: 'Calendar booking not found', code: 404 }
      });
    }
    return res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
};

/** Persisted outcome of the latest connectivity check (null when never run). */
export const getSyncState = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const state = await getSyncStatus();
    return res.json({ success: true, data: state });
  } catch (err) {
    next(err);
  }
};

/**
 * Run a real provider connectivity probe and persist the outcome.
 * Provider-side failures surface as 502 with the persisted failed state.
 */
export const runSync = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const state = await runCalendarSync();
    if (state.status === 'success') {
      return res.json({ success: true, data: state });
    }
    return res.status(502).json({
      success: false,
      error: { message: state.message || 'Calendar sync failed', code: 502 },
      data: state
    });
  } catch (err) {
    next(err);
  }
};

/** Read-only diagnostics report (always 200; state lives in the payload). */
export const getDiagnostics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const diagnostics = await getCalendarDiagnostics();
    return res.json({ success: true, data: diagnostics });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/calendar/bookings?page=&limit=
 * Paginated inventory of real persisted bookings (no demo meetings).
 */
export const listBookings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await listCalendarBookings({
      page: req.query.page,
      limit: req.query.limit
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    if (err.message && (err.message.includes('page') || err.message.includes('limit'))) {
      return res.status(400).json({
        success: false,
        error: { message: err.message, code: 400 }
      });
    }
    next(err);
  }
};

export const checkAvailability = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { start, end, timezone } = req.query || {};
    if (!isNonEmptyString(start) || !isNonEmptyString(end)) {
      return res.status(400).json({
        success: false,
        error: { message: 'start and end query parameters are required', code: 400 }
      });
    }
    const outcome = await checkCalendarAvailability({
      start: start as string,
      end: end as string,
      timezone: isNonEmptyString(timezone) ? (timezone as string) : null
    });
    if (outcome.ok) {
      return res.json({ success: true, data: { available: outcome.available } });
    }
    const statusBySkip: Record<string, number> = {
      invalid_slot: 422,
      no_config: 503,
      disabled: 503
    };
    const status = (outcome.skipped && statusBySkip[outcome.skipped]) || 502;
    return res.status(status).json({
      success: false,
      error: {
        message: isNotConfigured(outcome.skipped)
          ? CALENDAR_BOOKING_NOT_CONFIGURED_MESSAGE
          : `Availability check failed (${outcome.skipped || 'provider_error'})`,
        code: status
      }
    });
  } catch (err) {
    next(err);
  }
};
