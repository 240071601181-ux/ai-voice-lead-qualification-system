/**
 * Workspace settings API service.
 *
 * Backend routes (Express, src/routes/settingsRoutes.ts):
 *   GET   /api/v1/settings
 *   PATCH /api/v1/settings
 */

import { httpClient } from "../httpClient";
import type { WorkspaceSettings, WorkspaceSettingsPatch } from "../types";

export function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return httpClient.get<WorkspaceSettings>("/api/v1/settings");
}

export function patchWorkspaceSettings(patch: WorkspaceSettingsPatch): Promise<WorkspaceSettings> {
  return httpClient.patch<WorkspaceSettings>("/api/v1/settings", patch);
}
