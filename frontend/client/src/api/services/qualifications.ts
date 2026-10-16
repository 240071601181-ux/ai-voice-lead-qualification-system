/**
 * Phase 14C-3 — Qualification API service.
 * Phase 10 — plus the minimal read endpoints (list + by-id).
 * Phase 20 — internal admin API: every call carries the session (refresh
 * once-and-retried via `authedRequest`).
 *
 * Backend routes (existing Express backend, DO NOT MODIFY):
 *   POST /api/v1/qualifications
 *   GET  /api/v1/qualifications                 (page/limit, newest first)
 *   GET  /api/v1/qualifications/:id
 *   GET  /api/v1/qualifications/leads/:leadId
 *
 * (Phase 14: GET /api/v1/qualifications/calls/:callId retired with the
 * Calls UI; the repository read stays for legacy enrichment.)
 */

import { authedRequest } from "../session";
import { httpClient } from "../httpClient";
import type { CreateQualificationInput, Qualification } from "../types";

export interface QualificationListResult {
  qualifications: Qualification[];
  total: number;
  page: number;
  limit: number;
}

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

export function createQualification(data: CreateQualificationInput): Promise<Qualification> {
  return authed((headers) => httpClient.post<Qualification>("/api/v1/qualifications", data, { headers }));
}

export function listQualifications(page = 1, limit = 20): Promise<QualificationListResult> {
  return authed((headers) =>
    httpClient.get<QualificationListResult>("/api/v1/qualifications", {
      headers,
      query: { page, limit },
    })
  );
}

export function getQualificationById(id: string): Promise<Qualification> {
  return authed((headers) =>
    httpClient.get<Qualification>(`/api/v1/qualifications/${encodeURIComponent(id)}`, { headers })
  );
}

export interface QualificationMix {
  total: number;
  hot: number;
  warm: number;
  cold: number;
}

export function getQualificationMix(): Promise<QualificationMix> {
  return authed((headers) =>
    httpClient.get<QualificationMix>("/api/v1/dashboard/qualification-mix", { headers })
  );
}

export function getQualificationByLead(leadId: string): Promise<Qualification> {
  return authed((headers) =>
    httpClient.get<Qualification>(`/api/v1/qualifications/leads/${encodeURIComponent(leadId)}`, {
      headers,
    })
  );
}
