/**
 * Calendar connectivity checks ("Sync now").
 *
 * A sync run performs a REAL provider availability probe for the upcoming
 * 30-minute window (read-only; books nothing) and persists the outcome to
 * `calendar_sync_state`. Unconfigured/disabled calendar yields a truthful
 * failed record — never a faked success. No secrets are persisted.
 */
import { checkCalendarAvailability } from './calendarBookingService';
import { getCalendarConfig } from '../../config';
import {
  CalendarSyncState,
  getCalendarSyncState,
  recordCalendarSyncRun
} from '../../repositories/calendarSyncRepository';

export const getSyncStatus = async (): Promise<CalendarSyncState | null> => {
  return getCalendarSyncState();
};

export const runCalendarSync = async (): Promise<CalendarSyncState> => {
  const now = new Date();
  const probeEnd = new Date(now.getTime() + 30 * 60 * 1000);
  const timezone = getCalendarConfig().timezone;
  const outcome = await checkCalendarAvailability({
    start: now.toISOString(),
    end: probeEnd.toISOString(),
    timezone
  });
  if (outcome.ok) {
    return recordCalendarSyncRun(
      'success',
      outcome.available
        ? 'Calendar connected · probe window is free'
        : 'Calendar connected · probe window is busy'
    );
  }
  const message =
    outcome.skipped === 'disabled'
      ? 'Calendar sync is disabled (CALENDAR_ENABLED=false)'
      : outcome.skipped === 'no_config'
        ? 'Calendar is not configured (Google OAuth credentials missing)'
        : outcome.skipped === 'invalid_slot'
          ? 'Calendar sync probe failed (invalid slot)'
          : 'Calendar sync failed (provider_error)';
  return recordCalendarSyncRun('failed', message);
};
