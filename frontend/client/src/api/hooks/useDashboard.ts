/**
 * Phase 4 — React Query hook for the dashboard summary aggregate.
 *
 * Uses the shared QueryClient (via context — never creates a new one) and
 * the Phase 4 API service (never fetch/axios).
 *
 * Backend coverage (existing Express endpoint only):
 *   GET /api/v1/dashboard/summary -> useDashboardSummaryQuery
 *
 * One request feeds every dashboard metric card and the work-queue panel,
 * so the headline numbers and the breakdowns always share the same source.
 */

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../errors";
import { getDashboardSummary } from "../services/dashboard";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  summary: () => [...dashboardKeys.all, "summary"] as const,
};

/** Don't retry requests that will deterministically fail again. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (
    error instanceof ApiError &&
    (error.kind === "not-found" ||
      error.kind === "bad-request" ||
      error.kind === "unauthorized" ||
      error.kind === "forbidden")
  ) {
    return false;
  }
  return failureCount < 1;
}

/** Bounded dashboard aggregates (SQL counts only — never rows). */
export function useDashboardSummaryQuery() {
  return useQuery({
    queryKey: dashboardKeys.summary(),
    queryFn: () => getDashboardSummary(),
    retry: shouldRetry,
    staleTime: 30_000,
  });
}
