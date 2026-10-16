/**
 * Phase 4 — Dashboard summary API service.
 * Phase 20 — internal admin API: every call carries the session (refresh
 * once-and-retried via `authedRequest`).
 *
 * Backend route (Express, src/routes/dashboardRoutes.ts):
 *   GET /api/v1/dashboard/summary  (bounded SQL COUNT aggregates only —
 *   no row fetching; conversations scoped to the requesting user, exactly
 *   like the conversations list endpoint)
 */

import { authedRequest } from "../session";
import { httpClient } from "../httpClient";
import type { QualificationMix } from "./qualifications";

export interface DashboardSummary {
  leads: { total: number };
  qualifications: QualificationMix;
  conversations: { total: number; active: number; completed: number; abandoned: number };
  followups: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  bookings: { total: number; upcoming: number };
}

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

export function getDashboardSummary(): Promise<DashboardSummary> {
  return authed((headers) =>
    httpClient.get<DashboardSummary>("/api/v1/dashboard/summary", { headers })
  );
}
