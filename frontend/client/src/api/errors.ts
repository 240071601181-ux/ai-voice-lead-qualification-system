/**
 * Phase 14C-3 — Reusable frontend error handling.
 *
 * Maps transport problems and backend `{ success: false, error }` payloads
 * to a single `ApiError` with a stable `kind` so UI layers can render a
 * meaningful message without ever seeing stack traces or internal details.
 */

export type ApiErrorKind =
  | "network"
  | "timeout"
  | "malformed"
  | "bad-request"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "rate-limited"
  | "server"
  | "unavailable";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly details?: unknown;

  constructor(kind: ApiErrorKind, message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.details = details;
  }
}

export function errorKindForStatus(status: number): ApiErrorKind {
  if (status === 400 || status === 422) return "bad-request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate-limited";
  if (status === 503) return "unavailable";
  if (status >= 500) return "server";
  return "bad-request";
}

/**
 * User-safe message for the UI layer. Never includes stack traces or
 * internal backend error text beyond the backend's own public `message`.
 */
export function getUserMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case "network":
        return "Network unavailable. Check your connection and try again.";
      case "timeout":
        return "The request timed out. Please try again.";
      case "malformed":
        return "Received an unexpected response. Please try again.";
      case "bad-request":
        return error.message || "Some details look invalid. Review and retry.";
      case "unauthorized":
        return "Your session has expired. Please sign in again.";
      case "forbidden":
        return "You don't have permission to perform this action.";
      case "not-found":
        return "The requested item was not found.";
      case "conflict":
        return error.message || "This action conflicts with the current state.";
      case "rate-limited":
        return "Too many requests. Please wait a moment and retry.";
      case "unavailable":
        return "The backend is temporarily unavailable. Please try again later.";
      case "server":
        return "Something went wrong on the server. Please try again later.";
    }
  }
  return "Something went wrong. Please try again.";
}

/** Truthful user-facing message for unconfigured calendar booking. */
export const CALENDAR_BOOKING_NOT_CONFIGURED_MESSAGE =
  "Calendar booking is not configured. Connect Google Calendar to create a meeting.";

/**
 * Booking-form error message. Detects the backend's specific calendar
 * signals and shows truthful copy; every other failure keeps the generic
 * safe mapping (pinned by server/calendarSync.test.ts — never surface raw
 * provider text):
 * - 503 → calendar not configured (backend's own user-facing signal).
 * - 403 → qualification-tier gate (COLD-tier conversations cannot book;
 *   the backend persists this as a `tier` skip).
 * Deliberately distinct from sync-status messaging ("Calendar sync …").
 */
export function getCalendarBookingErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) {
    return CALENDAR_BOOKING_NOT_CONFIGURED_MESSAGE;
  }
  if (error instanceof ApiError && error.status === 403) {
    return "This conversation is not eligible for meeting booking yet (qualification tier).";
  }
  return getUserMessage(error);
}
