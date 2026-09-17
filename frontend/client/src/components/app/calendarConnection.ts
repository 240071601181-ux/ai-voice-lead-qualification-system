/**
 * Calendar connection honesty (pure, no React).
 *
 * Only a persisted successful sync counts as operational. Failed runs,
 * never-synced, or in-flight checks must never render "Operational" or
 * fabricated aggregates. Non-calendar integrations keep their existing
 * display untouched.
 */
import type { CalendarSyncRunStatus } from "@/api/types";

export type CalendarConnectionChip = "operational" | "checking" | "attention" | "not-configured";

export interface CalendarConnectionView {
  kicker: "CONNECTED SERVICE" | "SERVICE STATUS";
  chip: CalendarConnectionChip;
  chipLabel: string;
  metricsUnavailable: boolean;
}

export function calendarConnectionView(
  isCalendar: boolean,
  statusPending: boolean,
  status: CalendarSyncRunStatus | undefined
): CalendarConnectionView {
  if (!isCalendar) {
    return { kicker: "CONNECTED SERVICE", chip: "operational", chipLabel: "Operational", metricsUnavailable: false };
  }
  if (statusPending) {
    return { kicker: "CONNECTED SERVICE", chip: "checking", chipLabel: "Checking…", metricsUnavailable: true };
  }
  if (!status) {
    return { kicker: "SERVICE STATUS", chip: "not-configured", chipLabel: "Not configured", metricsUnavailable: true };
  }
  if (status !== "success") {
    return { kicker: "SERVICE STATUS", chip: "attention", chipLabel: "Attention required", metricsUnavailable: true };
  }
  // No aggregate endpoint exists, so metrics stay unavailable even on success.
  return { kicker: "CONNECTED SERVICE", chip: "operational", chipLabel: "Operational", metricsUnavailable: true };
}
