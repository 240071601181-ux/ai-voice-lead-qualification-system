/**
 * Phase 14C-3 — Calendar API service.
 * Phase 20 — internal admin API: every call carries the session (refresh
 * once-and-retried via `authedRequest`).
 *
 * Backend routes (existing Express backend, DO NOT MODIFY):
 *   POST /api/v1/calendar/bookings
 *   GET  /api/v1/calendar/bookings/:id
 *   GET  /api/v1/calendar/availability?start=...&end=...&timezone=...
 *   POST /api/v1/calendar/sync
 *   GET  /api/v1/calendar/sync-status
 */

import { authedRequest } from "../session";
import { httpClient } from "../httpClient";
import type {
  CalendarAvailabilityQuery,
  CalendarAvailabilityResult,
  CalendarBooking,
  CalendarDiagnostics,
  CalendarSyncState,
  CreateCalendarBookingInput,
  ListCalendarBookingsResult,
} from "../types";

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

export function createBooking(data: CreateCalendarBookingInput): Promise<CalendarBooking> {
  return authed((headers) =>
    httpClient.post<CalendarBooking>("/api/v1/calendar/bookings", data, { headers })
  );
}

export function getBooking(id: string): Promise<CalendarBooking> {
  return authed((headers) =>
    httpClient.get<CalendarBooking>(`/api/v1/calendar/bookings/${encodeURIComponent(id)}`, {
      headers,
    })
  );
}

export function getAvailability(query: CalendarAvailabilityQuery): Promise<CalendarAvailabilityResult> {
  return authed((headers) =>
    httpClient.get<CalendarAvailabilityResult>("/api/v1/calendar/availability", {
      headers,
      query: {
        start: query.start,
        end: query.end,
        timezone: query.timezone ?? undefined,
      },
    })
  );
}

export function runCalendarSync(): Promise<CalendarSyncState> {
  return authed((headers) =>
    httpClient.post<CalendarSyncState>("/api/v1/calendar/sync", {}, { headers })
  );
}

export function getCalendarSyncStatus(): Promise<CalendarSyncState | null> {
  return authed((headers) =>
    httpClient.get<CalendarSyncState | null>("/api/v1/calendar/sync-status", { headers })
  );
}

export function getCalendarDiagnostics(): Promise<CalendarDiagnostics> {
  return authed((headers) =>
    httpClient.get<CalendarDiagnostics>("/api/v1/calendar/diagnostics", { headers })
  );
}

/** Paginated inventory of real persisted bookings (no demo meetings). */
export function listCalendarBookings(page: number, limit: number): Promise<ListCalendarBookingsResult> {
  return authed((headers) =>
    httpClient.get<ListCalendarBookingsResult>("/api/v1/calendar/bookings", {
      headers,
      query: { page, limit },
    })
  );
}
