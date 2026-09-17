/**
 * Phase 14C-3 — Calendar API service.
 *
 * Backend routes (existing Express backend, DO NOT MODIFY):
 *   POST /api/v1/calendar/bookings
 *   GET  /api/v1/calendar/bookings/:id
 *   GET  /api/v1/calendar/availability?start=...&end=...&timezone=...
 *   POST /api/v1/calendar/sync
 *   GET  /api/v1/calendar/sync-status
 */

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

export function createBooking(data: CreateCalendarBookingInput): Promise<CalendarBooking> {
  return httpClient.post<CalendarBooking>("/api/v1/calendar/bookings", data);
}

export function getBooking(id: string): Promise<CalendarBooking> {
  return httpClient.get<CalendarBooking>(
    `/api/v1/calendar/bookings/${encodeURIComponent(id)}`
  );
}

export function getAvailability(query: CalendarAvailabilityQuery): Promise<CalendarAvailabilityResult> {
  return httpClient.get<CalendarAvailabilityResult>("/api/v1/calendar/availability", {
    query: {
      start: query.start,
      end: query.end,
      timezone: query.timezone ?? undefined,
    },
  });
}

export function runCalendarSync(): Promise<CalendarSyncState> {
  return httpClient.post<CalendarSyncState>("/api/v1/calendar/sync");
}

export function getCalendarSyncStatus(): Promise<CalendarSyncState | null> {
  return httpClient.get<CalendarSyncState | null>("/api/v1/calendar/sync-status");
}

export function getCalendarDiagnostics(): Promise<CalendarDiagnostics> {
  return httpClient.get<CalendarDiagnostics>("/api/v1/calendar/diagnostics");
}

/** Paginated inventory of real persisted bookings (no demo meetings). */
export function listCalendarBookings(page: number, limit: number): Promise<ListCalendarBookingsResult> {
  return httpClient.get<ListCalendarBookingsResult>("/api/v1/calendar/bookings", {
    query: { page, limit },
  });
}
