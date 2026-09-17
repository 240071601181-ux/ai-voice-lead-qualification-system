/**
 * Phase 14C-3 — Follow-up API service.
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

import { httpClient } from "../httpClient";
import type {
  ExecuteDueFollowupsInput,
  ExecuteDueFollowupsResult,
  FollowUp,
  FollowupListResult,
  ListFollowupsInput,
  ScheduleFollowupInput,
} from "../types";

export function scheduleFollowup(data: ScheduleFollowupInput): Promise<FollowUp> {
  return httpClient.post<FollowUp>("/api/v1/followups/schedule", data);
}

export function listFollowups(params: ListFollowupsInput = {}): Promise<FollowupListResult> {
  return httpClient.get<FollowupListResult>("/api/v1/followups", {
    query: {
      status: params.status || undefined,
      leadId: params.leadId || undefined,
      action: params.action || undefined,
      page: params.page,
      limit: params.limit,
    },
  });
}

export function getFollowup(id: string): Promise<FollowUp> {
  return httpClient.get<FollowUp>(`/api/v1/followups/${encodeURIComponent(id)}`);
}

export function executeFollowup(id: string): Promise<FollowUp> {
  return httpClient.post<FollowUp>(`/api/v1/followups/${encodeURIComponent(id)}/execute`);
}

export function cancelFollowup(id: string): Promise<FollowUp> {
  return httpClient.post<FollowUp>(`/api/v1/followups/${encodeURIComponent(id)}/cancel`);
}

export function retryFollowup(id: string): Promise<FollowUp> {
  return httpClient.post<FollowUp>(`/api/v1/followups/${encodeURIComponent(id)}/retry`);
}

/**
 * INTERNAL/admin only — runs due follow-ups. Intended for a future
 * scheduler/worker, not for user-facing UI actions.
 */
export function executeDueFollowups(
  data: ExecuteDueFollowupsInput = {}
): Promise<ExecuteDueFollowupsResult> {
  return httpClient.post<ExecuteDueFollowupsResult>("/api/v1/followups/execute-due", data);
}
