/**
 * Phase 12 – Google Calendar provider (official Google Calendar API via `googleapis`).
 *
 * Covers availability (`freebusy.query`), event creation (`events.insert`)
 * and Meet link creation (`conferenceData.createRequest` with a stable
 * `requestId`, which makes Meet generation idempotent across retries).
 * Authentication is OAuth2 refresh-token based; access tokens are refreshed
 * in memory by the client library and never persisted anywhere.
 *
 * Safety:
 * - Per-call timeout (never hangs the worker indefinitely).
 * - Errors are sanitized: no client secrets, tokens, codes, or bodies leak.
 * - Errors carry `retryable` + `status` flags consumed by the retry helper.
 */
import { calendar_v3, google } from 'googleapis';
import { getCalendarConfig } from '../../config';
import {
  AvailabilityQuery,
  AvailabilityResult,
  BookingRequest,
  BookingResult,
  CalendarProvider
} from './calendarProvider';

const buildAuthClient = () => {
  const cfg = getCalendarConfig();
  if (!cfg.clientId) {
    const err: any = new Error('GOOGLE_CLIENT_ID is not configured');
    err.retryable = false;
    throw err;
  }
  if (!cfg.clientSecret) {
    const err: any = new Error('GOOGLE_CLIENT_SECRET is not configured');
    err.retryable = false;
    throw err;
  }
  if (!cfg.refreshToken) {
    const err: any = new Error('GOOGLE_REFRESH_TOKEN is not configured');
    err.retryable = false;
    throw err;
  }
  const auth = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
  auth.setCredentials({ refresh_token: cfg.refreshToken });
  return auth;
};

const GOOGLE_RETRYABLE_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'backendError',
  'internalError'
]);

/**
 * OAuth token-endpoint failures (not Calendar API errors). `invalid_grant`
 * means the configured refresh token is expired, revoked, or was issued to a
 * different client. These are configuration problems: never retry them, and
 * surface them as such instead of as a transient provider outage.
 */
const AUTH_FAILURE_CODES = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client'
]);

const safeReasonCode = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return undefined;
  return /^[A-Za-z0-9_.-]+$/.test(trimmed) ? trimmed : undefined;
};

const requestReason = (err: any): string | undefined => {
  const data = err?.response?.data;
  // OAuth token endpoint: { error: "invalid_grant", error_description: ... }.
  const oauthCode = safeReasonCode(data?.error);
  if (oauthCode) return oauthCode;
  const errors = data?.error?.errors;
  if (Array.isArray(errors)) return safeReasonCode(errors[0]?.reason);
  return undefined;
};

const toProviderError = (err: any, action: string): never => {
  if (err && err.retryable !== undefined) throw err;
  const status: number | undefined =
    typeof err?.code === 'number' ? err.code : err?.response?.status;
  const code = err?.code;
  const timedOut = code === 'ECONNABORTED' || /timeout|deadline/i.test(err?.message || '');
  const reason = requestReason(err);
  const authFailed = reason !== undefined && AUTH_FAILURE_CODES.has(reason);
  const retryable =
    !authFailed &&
    (timedOut ||
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      status === 429 ||
      (typeof status === 'number' && status >= 500 && status < 600) ||
      (reason !== undefined && GOOGLE_RETRYABLE_REASONS.has(reason)));
  // Sanitized message: action + status + safe provider reason code only.
  // Never tokens, secrets, headers, or response bodies.
  const detail = reason ? `; ${reason}` : '';
  const safe: any = new Error(
    status
      ? `Google Calendar ${action} failed (status ${status}${detail})`
      : `Google Calendar ${action} failed (network error)`
  );
  safe.retryable = retryable;
  if (status !== undefined) safe.status = status;
  if (reason) safe.reason = reason;
  if (authFailed) safe.authFailed = true;
  if (timedOut) safe.timeout = true;
  if (typeof code === 'string') safe.code = code;
  throw safe;
};

const extractMeetUrl = (event: calendar_v3.Schema$Event): string | null => {
  if (typeof event.hangoutLink === 'string' && event.hangoutLink.length > 0) {
    return event.hangoutLink;
  }
  const entryPoints = event.conferenceData?.entryPoints;
  if (Array.isArray(entryPoints)) {
    const video = entryPoints.find(
      (entry) => entry?.entryPointType === 'video' && typeof entry.uri === 'string' && entry.uri.length > 0
    );
    if (video?.uri) return video.uri;
  }
  return null;
};

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = 'google';

  async checkAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
    try {
      const auth = buildAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });
      const response = await calendar.freebusy.query(
        {
          requestBody: {
            timeMin: query.slot.start,
            timeMax: query.slot.end,
            timeZone: query.slot.timezone,
            items: [{ id: query.calendarId }]
          }
        },
        { timeout: query.timeoutMs }
      );
      const calendars = response.data.calendars;
      const entry = calendars?.[query.calendarId];
      if (entry && Array.isArray((entry as any).errors) && (entry as any).errors.length > 0) {
        const err: any = new Error('Google Calendar availability check failed (calendar error)');
        err.retryable = false;
        throw err;
      }
      const busy = entry?.busy;
      return { available: !Array.isArray(busy) || busy.length === 0 };
    } catch (err: any) {
      throw toProviderError(err, 'availability check');
    }
  }

  async createEvent(request: BookingRequest): Promise<BookingResult> {
    try {
      const auth = buildAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });
      const response = await calendar.events.insert(
        {
          calendarId: request.calendarId,
          conferenceDataVersion: 1,
          requestBody: {
            summary: request.summary,
            description: request.description,
            start: { dateTime: request.slot.start, timeZone: request.slot.timezone },
            end: { dateTime: request.slot.end, timeZone: request.slot.timezone },
            attendees: request.attendees,
            conferenceData: {
              createRequest: {
                requestId: request.idempotencyKey,
                conferenceSolutionKey: { type: 'hangoutsMeet' }
              }
            }
          }
        },
        { timeout: request.timeoutMs }
      );
      const event = response.data;
      if (!event.id) {
        const err: any = new Error('Google Calendar booking returned no event id');
        err.retryable = true;
        throw err;
      }
      return { externalEventId: event.id, meetUrl: extractMeetUrl(event) };
    } catch (err: any) {
      // Duplicate insert: resolve to the already-booked event instead of failing.
      if (err?.response?.status === 409 || err?.code === 409) {
        const dup: any = new Error('Google Calendar booking already exists');
        dup.retryable = false;
        dup.duplicate = true;
        throw dup;
      }
      throw toProviderError(err, 'booking');
    }
  }
}
