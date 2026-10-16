/**
 * Phase 14C-3 — Follow-up API service.
 * Phase 20 — internal admin API: every call carries the session (refresh
 * once-and-retried via `authedRequest`).
 *
 * Backend routes (existing Express backend, DO NOT MODIFY):
 *   POST /api/v1/followups/schedule
 *   GET  /api/v1/followups            (status/leadId/action/page/limit, paginated)
 *   GET  /api/v1/followups/:id
 *   POST /api/v1/followups/:id/execute
 *   POST /api/v1/followups/:id/cancel
 *   POST /api/v1/followups/:id/retry
 *   POST /api/v1/followups/execute-due   (INTERNAL/admin only)
 *
 * IMPORTANT: `executeDueFollowups` is internal/admin functionality for a
 * future scheduler/worker. Do NOT expose it as a normal user-facing action.
 */

import { authedRequest } from "../session";
import { httpClient } from "../httpClient";
import type {
  ExecuteDueFollowupsInput,
  ExecuteDueFollowupsResult,
  FollowUp,
  FollowupListResult,
  ListFollowupsInput,
  ScheduleFollowupInput,
} from "../types";

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

export function scheduleFollowup(data: ScheduleFollowupInput): Promise<FollowUp> {
  return authed((headers) =>
    httpClient.post<FollowUp>("/api/v1/followups/schedule", data, { headers })
  );
}

export function listFollowups(params: ListFollowupsInput = {}): Promise<FollowupListResult> {
  return authed((headers) =>
    httpClient.get<FollowupListResult>("/api/v1/followups", {
      headers,
      query: {
        status: params.status || undefined,
        leadId: params.leadId || undefined,
        action: params.action || undefined,
        page: params.page,
        limit: params.limit,
      },
    })
  );
}

export function getFollowup(id: string): Promise<FollowUp> {
  return authed((headers) =>
    httpClient.get<FollowUp>(`/api/v1/followups/${encodeURIComponent(id)}`, { headers })
  );
}

export function executeFollowup(id: string): Promise<FollowUp> {
  return authed((headers) =>
    httpClient.post<FollowUp>(`/api/v1/followups/${encodeURIComponent(id)}/execute`, {}, { headers })
  );
}

export function cancelFollowup(id: string): Promise<FollowUp> {
  return authed((headers) =>
    httpClient.post<FollowUp>(`/api/v1/followups/${encodeURIComponent(id)}/cancel`, {}, { headers })
  );
}

export function retryFollowup(id: string): Promise<FollowUp> {
  return authed((headers) =>
    httpClient.post<FollowUp>(`/api/v1/followups/${encodeURIComponent(id)}/retry`, {}, { headers })
  );
}

/**
 * INTERNAL/admin only — runs due follow-ups. Intended for a future
 * scheduler/worker, not for user-facing UI actions.
 */
export function executeDueFollowups(
  data: ExecuteDueFollowupsInput = {}
): Promise<ExecuteDueFollowupsResult> {
  return authed((headers) =>
    httpClient.post<ExecuteDueFollowupsResult>("/api/v1/followups/execute-due", data, { headers })
  );
}
