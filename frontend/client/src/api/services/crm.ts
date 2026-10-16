/**
 * CRM API service.
 * Phase 20 — internal admin API: every call carries the session (refresh
 * once-and-retried via `authedRequest`).
 *
 * Backend routes (Express, src/routes/crmRoutes.ts):
 *   GET  /api/v1/crm/diagnostics
 *   POST /api/v1/crm/sync        { leadId?, callId? } (explicit operator sync)
 *   GET  /api/v1/crm/syncs?limit=
 */

import { authedRequest } from "../session";
import { httpClient } from "../httpClient";
import type { CrmDiagnostics, CrmSyncAttempt, CrmSyncNowResult } from "../types";

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

export function getCrmDiagnostics(): Promise<CrmDiagnostics> {
  return authed((headers) => httpClient.get<CrmDiagnostics>("/api/v1/crm/diagnostics", { headers }));
}

export function runCrmSync(data: { leadId?: string; callId?: string }): Promise<CrmSyncNowResult> {
  return authed((headers) => httpClient.post<CrmSyncNowResult>("/api/v1/crm/sync", data, { headers }));
}

export function listCrmSyncs(limit = 10): Promise<CrmSyncAttempt[]> {
  return authed((headers) =>
    httpClient.get<CrmSyncAttempt[]>("/api/v1/crm/syncs", { headers, query: { limit } })
  );
}
