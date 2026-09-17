/**
 * React Query hooks for n8n backend integration.
 *
 * Backend coverage (Express, src/routes/n8nRoutes.ts):
 *   GET /api/v1/n8n/diagnostics  -> useN8nDiagnosticsQuery
 *   GET /api/v1/n8n/workflows    -> useN8nWorkflowsQuery
 *
 * There is deliberately NO emit hook: emitting would fire real customer
 * workflows from the browser.
 */

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../errors";
import { getN8nDiagnostics, listN8nWorkflows } from "../services/n8n";

export const n8nKeys = {
  all: ["n8n"] as const,
  diagnostics: () => [...n8nKeys.all, "diagnostics"] as const,
  workflows: () => [...n8nKeys.all, "workflows"] as const,
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
 * Real n8n diagnostics. Fetched on mount so results persist in the UI;
 * "Run diagnostics" refetches explicitly.
 */
export function useN8nDiagnosticsQuery(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: n8nKeys.diagnostics(),
    queryFn: () => getN8nDiagnostics(),
    retry: shouldRetry,
    staleTime: 0,
    enabled: opts?.enabled ?? true,
  });
}

/** Configured workflows with real delivery stats. */
export function useN8nWorkflowsQuery() {
  return useQuery({
    queryKey: n8nKeys.workflows(),
    queryFn: () => listN8nWorkflows(),
    retry: shouldRetry,
    staleTime: 0,
  });
}
