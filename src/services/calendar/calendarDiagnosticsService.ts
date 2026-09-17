/**
 * Calendar diagnostics (read-only).
 *
 * Inspects the existing Calendar architecture and reports structured,
 * secret-free results: whether scheduling is enabled, whether the
 * provider is configured (credential presence only — never values),
 * whether the calendar tables are reachable, and — only when safely
 * possible (enabled + configured) — a real provider connectivity probe.
 * Never writes bookings, never sends messages, never exposes secrets.
 */
import { pool } from '../../database';
import { getCalendarConfig, isCalendarEnabled } from '../../config';
import { checkCalendarAvailability, sanitizeCalendarErrorMessage } from './calendarBookingService';

export type CalendarDiagnosticStatus = 'ok' | 'failed' | 'skipped';

export interface CalendarDiagnosticCheck {
  name: string;
  status: CalendarDiagnosticStatus;
  message: string;
}

export type CalendarDiagnosticsOverall = 'ok' | 'not_configured' | 'error';

export interface CalendarDiagnostics {
  status: CalendarDiagnosticsOverall;
  checks: CalendarDiagnosticCheck[];
}

const CALENDAR_TABLES = ['calendar_bookings', 'calendar_sync_state'];

const tableReachable = async (table: string): Promise<boolean> => {
  try {
    await pool.query(`SELECT 1 FROM ${table} LIMIT 0`);
    return true;
  } catch {
    return false;
  }
};

export const getCalendarDiagnostics = async (): Promise<CalendarDiagnostics> => {
  const checks: CalendarDiagnosticCheck[] = [];

  const enabled = isCalendarEnabled();
  checks.push({
    name: 'enabled',
    status: enabled ? 'ok' : 'failed',
    message: enabled
      ? 'Calendar scheduling is enabled (CALENDAR_ENABLED=true)'
      : 'Calendar scheduling is disabled (CALENDAR_ENABLED=false)'
  });

  const cfg = getCalendarConfig();
  const hasCredentials = !!(cfg.clientId && cfg.clientSecret && cfg.refreshToken && cfg.calendarId);
  checks.push({
    name: 'provider',
    status: hasCredentials ? 'ok' : 'failed',
    message: hasCredentials
      ? `Provider '${cfg.provider}' is configured (OAuth credentials present)`
      : `Provider '${cfg.provider}' is not configured (Google OAuth credentials missing)`
  });

  let databaseOk = false;
  try {
    await pool.query('SELECT 1');
    const reachability = await Promise.all(CALENDAR_TABLES.map(tableReachable));
    databaseOk = reachability.every(Boolean);
    checks.push({
      name: 'database',
      status: databaseOk ? 'ok' : 'failed',
      message: databaseOk
        ? 'Database reachable; calendar tables present (calendar_bookings, calendar_sync_state)'
        : 'Database reachable, but a calendar table is missing'
    });
  } catch (err: any) {
    checks.push({
      name: 'database',
      status: 'failed',
      message: `Database unreachable (${sanitizeCalendarErrorMessage(err)})`
    });
  }

  if (enabled && hasCredentials && databaseOk) {
    const now = new Date();
    const probeEnd = new Date(now.getTime() + 30 * 60 * 1000);
    try {
      const outcome = await checkCalendarAvailability({
        start: now.toISOString(),
        end: probeEnd.toISOString(),
        timezone: cfg.timezone
      });
      checks.push({
        name: 'connectivity',
        status: outcome.ok ? 'ok' : 'failed',
        message: outcome.ok
          ? 'Provider connectivity check passed (availability probe)'
          : 'Provider connectivity check failed'
      });
    } catch (err: any) {
      checks.push({
        name: 'connectivity',
        status: 'failed',
        message: `Provider connectivity check failed (${sanitizeCalendarErrorMessage(err)})`
      });
    }
  } else {
    checks.push({
      name: 'connectivity',
      status: 'skipped',
      message: 'Connectivity not attempted (calendar disabled or unconfigured)'
    });
  }

  const failed = checks.some((c) => c.status === 'failed');
  const status: CalendarDiagnosticsOverall = !enabled || !hasCredentials
    ? 'not_configured'
    : failed ? 'error' : 'ok';
  return { status, checks };
};
