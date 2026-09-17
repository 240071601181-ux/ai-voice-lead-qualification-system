/**
 * React Query hooks for CRM backend integration.
 *
 * Backend coverage (Express, src/routes/crmRoutes.ts):
 *   GET  /api/v1/crm/diagnostics  -> useCrmDiagnosticsQuery
 *   POST /api/v1/crm/sync         -> useRunCrmSyncMutation
 *   GET  /api/v1/crm/syncs        -> useCrmSyncsQuery
 *
 * Uses the shared QueryClient (via context — never creates a new one) and
 * the API services (never fetch/axios).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../errors";
import { getCrmDiagnostics, listCrmSyncs, runCrmSync } from "../services/crm";

export const crmKeys = {
  all: ["crm"] as const,
  diagnostics: () => [...crmKeys.all, "diagnostics"] as const,
  syncs: () => [...crmKeys.all, "syncs"] as const,
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

/**
 * Real CRM diagnostics. Fetched on mount so results persist in the UI;
 * "Run diagnostics" refetches explicitly.
 */
export function useCrmDiagnosticsQuery(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: crmKeys.diagnostics(),
    queryFn: () => getCrmDiagnostics(),
    retry: shouldRetry,
    staleTime: 0,
    enabled: opts?.enabled ?? true,
  });
}

/** Recent sync attempts (real rows). */
export function useCrmSyncsQuery(limit = 10) {
  return useQuery({
    queryKey: [...crmKeys.syncs(), limit] as const,
    queryFn: () => listCrmSyncs(limit),
    retry: shouldRetry,
    staleTime: 0,
  });
}

/** Explicit operator sync for one lead/call. Refreshes diagnostics + list. */
export function useRunCrmSyncMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { leadId?: string; callId?: string }) => runCrmSync(input),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: crmKeys.diagnostics() });
      queryClient.invalidateQueries({ queryKey: crmKeys.syncs() });
    },
  });
}
