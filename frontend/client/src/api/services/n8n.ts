/**
 * n8n API service.
 *
 * Backend routes (Express, src/routes/n8nRoutes.ts):
 *   GET /api/v1/n8n/diagnostics
 *   GET /api/v1/n8n/workflows
 *
 * There is deliberately NO emit/test endpoint: emitting would fire real
 * customer workflows from the browser.
 */

import { httpClient } from "../httpClient";
import type { N8nDiagnostics, N8nWorkflowStatus } from "../types";

export function getN8nDiagnostics(): Promise<N8nDiagnostics> {
  return httpClient.get<N8nDiagnostics>("/api/v1/n8n/diagnostics");
}

export function listN8nWorkflows(): Promise<N8nWorkflowStatus[]> {
  return httpClient.get<N8nWorkflowStatus[]>("/api/v1/n8n/workflows");
}
