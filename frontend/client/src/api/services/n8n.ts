/**
 * n8n API service.
 * Phase 20 — internal admin API: every call carries the session (refresh
 * once-and-retried via `authedRequest`).
 *
 * Backend routes (Express, src/routes/n8nRoutes.ts):
 *   GET /api/v1/n8n/diagnostics
 *   GET /api/v1/n8n/workflows
 *
 * There is deliberately NO emit/test endpoint: emitting would fire real
 * customer workflows from the browser.
 */

import { authedRequest } from "../session";
import { httpClient } from "../httpClient";
import type { N8nDiagnostics, N8nWorkflowStatus } from "../types";

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

export function getN8nDiagnostics(): Promise<N8nDiagnostics> {
  return authed((headers) => httpClient.get<N8nDiagnostics>("/api/v1/n8n/diagnostics", { headers }));
}

export function listN8nWorkflows(): Promise<N8nWorkflowStatus[]> {
  return authed((headers) =>
    httpClient.get<N8nWorkflowStatus[]>("/api/v1/n8n/workflows", { headers })
  );
}
