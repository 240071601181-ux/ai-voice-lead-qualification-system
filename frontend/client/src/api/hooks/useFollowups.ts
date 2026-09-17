/**
 * Phase 14C-7 — React Query hooks for Follow-ups backend integration.
 *
 * Uses the shared QueryClient (via context — never creates a new one) and the
 * Phase 14C-3 API services (never fetch/axios).
 *
 * Backend coverage (existing Express endpoints only):
 *   GET  /api/v1/followups          -> useFollowupsQuery (filter/page/limit)
 *   GET  /api/v1/followups/:id          -> useFollowupQuery
 *   POST /api/v1/followups/schedule     -> useScheduleFollowupMutation
 *   POST /api/v1/followups/:id/execute  -> useExecuteFollowupMutation
 *   POST /api/v1/followups/:id/cancel   -> useCancelFollowupMutation
 *   POST /api/v1/followups/:id/retry    -> useRetryFollowupMutation
 *
 * POST /api/v1/followups/execute-due is INTERNAL/admin only and is
 * deliberately NOT exposed through any hook here.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../errors";
import {
  cancelFollowup,
  executeFollowup,
  getFollowup,
  listFollowups,
  retryFollowup,
  scheduleFollowup,
} from "../services/followups";
import type { FollowUp, FollowupListResult, ListFollowupsInput, ScheduleFollowupInput } from "../types";

export const followupKeys = {
  all: ["followups"] as const,
  lists: () => [...followupKeys.all, "list"] as const,
  list: (params: ListFollowupsInput) => [...followupKeys.lists(), params] as const,
  detail: (id: string) => [...followupKeys.all, "detail", id] as const,
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

/** Backend follow-up record by id. Enabled only when an id is present. */
export function useFollowupQuery(id: string | undefined) {
  return useQuery({
    queryKey: followupKeys.detail(id ?? ""),
    queryFn: () => getFollowup(id as string),
    enabled: !!id,
    retry: shouldRetry,
    staleTime: 30_000,
  });
}

/** Paginated backend follow-up rows. Previous page stays visible while refetching. */
export function useFollowupsQuery(params: ListFollowupsInput, opts?: { enabled?: boolean }) {
  return useQuery<FollowupListResult>({
    queryKey: followupKeys.list(params),
    queryFn: () => listFollowups(params),
    retry: shouldRetry,
    staleTime: 15_000,
    placeholderData: (previousData) => previousData,
    enabled: opts?.enabled ?? true,
  });
}

function useFollowupActionMutation(
  action: (id: string) => Promise<FollowUp>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => action(id),
    onSuccess: (followup) => {
      queryClient.setQueryData(followupKeys.detail(followup.id), followup);
      queryClient.invalidateQueries({ queryKey: followupKeys.detail(followup.id) });
      // Refresh the live list so execute/cancel/retry state changes appear.
      queryClient.invalidateQueries({ queryKey: followupKeys.all });
    },
  });
}

/**
 * Schedule a follow-up. Sends ONLY backend-supported fields
 * (leadId/callId/action/scheduledAt/template) — no policy logic here.
 */
export function useScheduleFollowupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduleFollowupInput) => scheduleFollowup(input),
    onSuccess: (followup) => {
      queryClient.setQueryData(followupKeys.detail(followup.id), followup);
      queryClient.invalidateQueries({ queryKey: followupKeys.all });
    },
  });
}

/** POST /api/v1/followups/:id/execute */
export function useExecuteFollowupMutation() {
  return useFollowupActionMutation(executeFollowup);
}

/** POST /api/v1/followups/:id/cancel */
export function useCancelFollowupMutation() {
  return useFollowupActionMutation(cancelFollowup);
}

/** POST /api/v1/followups/:id/retry */
export function useRetryFollowupMutation() {
  return useFollowupActionMutation(retryFollowup);
}
