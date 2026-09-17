/**
 * CRM API service.
 *
 * Backend routes (Express, src/routes/crmRoutes.ts):
 *   GET  /api/v1/crm/diagnostics
 *   POST /api/v1/crm/sync        { leadId?, callId? } (explicit operator sync)
 *   GET  /api/v1/crm/syncs?limit=
 */

import { httpClient } from "../httpClient";
import type { CrmDiagnostics, CrmSyncAttempt, CrmSyncNowResult } from "../types";

export function getCrmDiagnostics(): Promise<CrmDiagnostics> {
  return httpClient.get<CrmDiagnostics>("/api/v1/crm/diagnostics");
}

export function runCrmSync(data: { leadId?: string; callId?: string }): Promise<CrmSyncNowResult> {
  return httpClient.post<CrmSyncNowResult>("/api/v1/crm/sync", data);
}

export function listCrmSyncs(limit = 10): Promise<CrmSyncAttempt[]> {
  return httpClient.get<CrmSyncAttempt[]>("/api/v1/crm/syncs", { query: { limit } });
}
