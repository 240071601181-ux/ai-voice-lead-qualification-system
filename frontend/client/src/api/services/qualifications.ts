/**
 * Phase 14C-3 — Qualification API service.
 * Phase 10 — plus the minimal read endpoints (list + by-id).
 *
 * Backend routes (existing Express backend, DO NOT MODIFY):
 *   POST /api/v1/qualifications
 *   GET  /api/v1/qualifications                 (page/limit, newest first)
 *   GET  /api/v1/qualifications/:id
 *   GET  /api/v1/qualifications/calls/:callId
 *   GET  /api/v1/qualifications/leads/:leadId
 */

import { httpClient } from "../httpClient";
import type { CreateQualificationInput, Qualification } from "../types";

export interface QualificationListResult {
  qualifications: Qualification[];
  total: number;
  page: number;
  limit: number;
}

export function createQualification(data: CreateQualificationInput): Promise<Qualification> {
  return httpClient.post<Qualification>("/api/v1/qualifications", data);
}

export function listQualifications(page = 1, limit = 20): Promise<QualificationListResult> {
  return httpClient.get<QualificationListResult>("/api/v1/qualifications", {
    query: { page, limit },
  });
}

export function getQualificationById(id: string): Promise<Qualification> {
  return httpClient.get<Qualification>(
    `/api/v1/qualifications/${encodeURIComponent(id)}`
  );
}

export function getQualificationByCall(callId: string): Promise<Qualification> {
  return httpClient.get<Qualification>(
    `/api/v1/qualifications/calls/${encodeURIComponent(callId)}`
  );
}

export function getQualificationByLead(leadId: string): Promise<Qualification> {
  return httpClient.get<Qualification>(
    `/api/v1/qualifications/leads/${encodeURIComponent(leadId)}`
  );
}
