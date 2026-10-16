/**
 * Phase 14C-3 — Lead API service.
 * Phase 20 — internal admin API: every call carries the session (refresh
 * once-and-retried via `authedRequest`).
 *
 * Backend routes (existing Express backend, DO NOT MODIFY):
 *   POST  /api/v1/leads
 *   GET   /api/v1/leads            (search/page/limit, paginated w/ total)
 *   GET   /api/v1/leads/:id
 *   PATCH /api/v1/leads/:id
 */

import { authedRequest } from "../session";
import { httpClient } from "../httpClient";
import type { CreateLeadInput, Lead, LeadListResult, ListLeadsInput, UpdateLeadInput } from "../types";

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

export function createLead(data: CreateLeadInput): Promise<Lead> {
  return authed((headers) => httpClient.post<Lead>("/api/v1/leads", data, { headers }));
}

export function listLeads(params: ListLeadsInput = {}): Promise<LeadListResult> {
  return authed((headers) =>
    httpClient.get<LeadListResult>("/api/v1/leads", {
      headers,
      query: {
        search: params.search || undefined,
        page: params.page,
        limit: params.limit,
      },
    })
  );
}

export function getLead(id: string): Promise<Lead> {
  return authed((headers) =>
    httpClient.get<Lead>(`/api/v1/leads/${encodeURIComponent(id)}`, { headers })
  );
}

export function updateLead(id: string, data: UpdateLeadInput): Promise<Lead> {
  return authed((headers) =>
    httpClient.patch<Lead>(`/api/v1/leads/${encodeURIComponent(id)}`, data, { headers })
  );
}
