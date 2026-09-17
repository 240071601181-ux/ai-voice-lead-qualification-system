/**
 * React Query hooks for workspace settings.
 *
 * Backend coverage (Express, src/routes/settingsRoutes.ts):
 *   GET   /api/v1/settings  -> useWorkspaceSettingsQuery
 *   PATCH /api/v1/settings  -> useUpdateWorkspaceSettingsMutation
 *
 * The query is always fresh on mount so navigation and browser refresh
 * re-read persisted values — no localStorage-only state.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../errors";
import { getWorkspaceSettings, patchWorkspaceSettings } from "../services/settings";
import type { WorkspaceSettingsPatch } from "../types";

export const settingsKeys = {
  all: ["workspace-settings"] as const,
  current: () => [...settingsKeys.all, "current"] as const,
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

/** Current persisted settings. Refetch invalidates stale UI after save. */
export function useWorkspaceSettingsQuery() {
  return useQuery({
    queryKey: settingsKeys.current(),
    queryFn: () => getWorkspaceSettings(),
    retry: shouldRetry,
    staleTime: 0,
  });
}

/** Persist a settings patch, then refetch the persisted row. */
export function useUpdateWorkspaceSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: WorkspaceSettingsPatch) => patchWorkspaceSettings(patch),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.current() });
    },
  });
}
