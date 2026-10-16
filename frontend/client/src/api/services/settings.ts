/**
 * Workspace settings API service.
 * Phase 20 — internal admin API: every call carries the session (refresh
 * once-and-retried via `authedRequest`).
 *
 * Backend routes (Express, src/routes/settingsRoutes.ts):
 *   GET   /api/v1/settings
 *   PATCH /api/v1/settings
 */

import { authedRequest } from "../session";
import { httpClient } from "../httpClient";
import type { WorkspaceSettings, WorkspaceSettingsPatch } from "../types";

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

export function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return authed((headers) => httpClient.get<WorkspaceSettings>("/api/v1/settings", { headers }));
}

export function patchWorkspaceSettings(patch: WorkspaceSettingsPatch): Promise<WorkspaceSettings> {
  return authed((headers) =>
    httpClient.patch<WorkspaceSettings>("/api/v1/settings", patch, { headers })
  );
}
