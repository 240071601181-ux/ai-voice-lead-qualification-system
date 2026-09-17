/**
 * React Query hooks for the AI Agent page backend integration.
 *
 * Backend coverage (Express, src/routes/agentRoutes.ts):
 *   GET   /api/v1/agent/config  -> useAgentConfigQuery
 *   PATCH /api/v1/agent/config  -> useUpdateAgentConfigMutation
 *   POST  /api/v1/agent/pause   -> usePauseAgentMutation
 *   POST  /api/v1/agent/resume  -> useResumeAgentMutation
 *   GET   /api/v1/agent/health  -> useAgentHealthQuery
 *
 * Uses the shared QueryClient (via context — never creates a new one) and
 * the agent API services (never fetch/axios).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../errors";
import {
  getAgentConfig,
  getAgentHealth,
  patchAgentConfig,
  pauseAgent,
  resumeAgent,
} from "../services/agent";
import type { AgentConfigPatch } from "../types";

export const agentKeys = {
  all: ["agent"] as const,
  config: () => [...agentKeys.all, "config"] as const,
  health: () => [...agentKeys.all, "health"] as const,
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

/** Current agent configuration. Always fresh on mount so a page refresh
 * re-reads persisted values from the backend. */
export function useAgentConfigQuery() {
  return useQuery({
    queryKey: agentKeys.config(),
    queryFn: () => getAgentConfig(),
    retry: shouldRetry,
    staleTime: 0,
  });
}

/** Honest agent health (real flags; metrics null when uncollected). */
export function useAgentHealthQuery() {
  return useQuery({
    queryKey: agentKeys.health(),
    queryFn: () => getAgentHealth(),
    retry: shouldRetry,
    staleTime: 0,
  });
}

function useInvalidateAgent() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: agentKeys.config() });
    queryClient.invalidateQueries({ queryKey: agentKeys.health() });
  };
}

/** Persist edited conversation behavior. Refreshes config + health. */
export function useUpdateAgentConfigMutation() {
  const invalidate = useInvalidateAgent();
  return useMutation({
    mutationFn: (patch: AgentConfigPatch) => patchAgentConfig(patch),
    onSettled: () => {
      invalidate();
    },
  });
}

/** Pause the agent (persisted backend-side). */
export function usePauseAgentMutation() {
  const invalidate = useInvalidateAgent();
  return useMutation({
    mutationFn: () => pauseAgent(),
    onSettled: () => {
      invalidate();
    },
  });
}

/** Resume the agent (persisted backend-side). */
export function useResumeAgentMutation() {
  const invalidate = useInvalidateAgent();
  return useMutation({
    mutationFn: () => resumeAgent(),
    onSettled: () => {
      invalidate();
    },
  });
}
