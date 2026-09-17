/**
 * Phase 14C-5 — React Query hooks for Qualifications backend integration.
 *
 * Uses the shared QueryClient (via context — never creates a new one) and the
 * Phase 14C-3 API services (never fetch/axios).
 *
 * Backend coverage (existing Express endpoints only):
 *   GET  /api/v1/qualifications/leads/:leadId  -> useQualificationByLead
 *   GET  /api/v1/qualifications/calls/:callId  -> useQualificationByCall
 *   POST /api/v1/qualifications                -> useCreateQualificationMutation
 *
 * There is NO GET-all and NO GET-by-qualification-id endpoint, so there is
 * deliberately no list query and no by-id query here. The /qualifications
 * list keeps using mock data until a backend list endpoint exists.
 */

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../errors";
import {
  createQualification,
  getQualificationByCall,
  getQualificationById,
  getQualificationByLead,
  listQualifications,
} from "../services/qualifications";
import type { CreateQualificationInput, Lead as ApiLead, Qualification as ApiQualification } from "../types";
import { useLeadsQuery } from "./useLeads";

export const qualificationKeys = {
  all: ["qualifications"] as const,
  lists: () => [...qualificationKeys.all, "list"] as const,
  list: (page: number, limit: number) => [...qualificationKeys.lists(), page, limit] as const,
  byId: (id: string) => [...qualificationKeys.all, "id", id] as const,
  byLead: (leadId: string) => [...qualificationKeys.all, "lead", leadId] as const,
  byCall: (callId: string) => [...qualificationKeys.all, "call", callId] as const,
  /** Lookup backing the /qualifications/:id page (by-id, then lead, then call). */
  detail: (id: string) => [...qualificationKeys.all, "detail", id] as const,
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

function toError(error: unknown): ApiError | Error {
  return error instanceof Error ? error : new Error("Something went wrong.");
}

export interface QualificationLookup {
  qualification: ApiQualification;
  via: "lead" | "call";
}

/** Paginated backend qualification list (all anchors), newest first. */
export function useQualificationsListQuery(page: number, limit: number, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qualificationKeys.list(page, limit),
    queryFn: () => listQualifications(page, limit),
    retry: shouldRetry,
    staleTime: 15_000,
    placeholderData: (previousData) => previousData,
    enabled: opts?.enabled ?? true,
  });
}

/** Backend qualification by its own id (call- and conversation-anchored). */
export function useQualificationById(id: string | undefined) {
  return useQuery({
    queryKey: qualificationKeys.byId(id ?? ""),
    queryFn: () => getQualificationById(id as string),
    enabled: !!id,
    retry: shouldRetry,
    staleTime: 30_000,
  });
}

/** Latest qualification for a backend lead id. Enabled only when present. */
export function useQualificationByLead(leadId: string | undefined) {
  return useQuery({
    queryKey: qualificationKeys.byLead(leadId ?? ""),
    queryFn: () => getQualificationByLead(leadId as string),
    enabled: !!leadId,
    retry: shouldRetry,
    staleTime: 30_000,
  });
}

/** Qualification attached to a backend call id. Enabled only when present. */
export function useQualificationByCall(callId: string | undefined) {
  return useQuery({
    queryKey: qualificationKeys.byCall(callId ?? ""),
    queryFn: () => getQualificationByCall(callId as string),
    enabled: !!callId,
    retry: shouldRetry,
    staleTime: 30_000,
  });
}

/**
 * Run (or re-run) qualification for a call. Sends ONLY `{ callId }` — the
 * single field the backend accepts. Scoring stays backend-side; the returned
 * record (score + tier) is the source of truth, never computed here.
 */
export function useCreateQualificationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateQualificationInput) => createQualification(input),
    onSuccess: (qualification) => {
      if (qualification.call_id) {
        queryClient.setQueryData(qualificationKeys.byCall(qualification.call_id), qualification);
      }
      if (qualification.lead_id) {
        queryClient.setQueryData(qualificationKeys.byLead(qualification.lead_id), qualification);
      }
      queryClient.invalidateQueries({ queryKey: qualificationKeys.all });
    },
  });
}

export type QualificationDetailResult =
  | { status: "loading" }
  | { status: "ready"; source: "api"; lookup: QualificationLookup; refetch: () => void }
  | { status: "not-found" }
  | { status: "error"; error: ApiError | Error; refetch: () => void };

/**
 * Detail resolution for /qualifications/:id. All backend, no mock fallback:
 * direct by-id lookup first (covers call- and conversation-anchored rows),
 * then the raw route id as a lead id, then as a call id.
 */
export function useQualificationDetail(
  id: string | undefined,
  leadId?: string
): QualificationDetailResult {
  const query = useQuery({
    queryKey: qualificationKeys.detail(id ?? ""),
    queryFn: async (): Promise<QualificationLookup> => {
      const routeId = id as string;
      try {
        const qualification = await getQualificationById(routeId);
        return { qualification, via: qualification.call_id ? "call" : "lead" };
      } catch (error) {
        if (!(error instanceof ApiError) || error.kind !== "not-found") throw error;
      }
      // Lead-first: associated lead when known, else the raw route id.
      const leadCandidates = [leadId, leadId ? undefined : routeId].filter(
        (v): v is string => !!v
      );
      for (const candidate of leadCandidates) {
        try {
          return { qualification: await getQualificationByLead(candidate), via: "lead" };
        } catch (error) {
          if (!(error instanceof ApiError) || error.kind !== "not-found") throw error;
        }
      }
      // Then the raw route id as a call id (mock fixtures carry no call id,
      // so this only fires for ids without a known lead association).
      if (!leadId) {
        try {
          return { qualification: await getQualificationByCall(routeId), via: "call" };
        } catch (error) {
          if (!(error instanceof ApiError) || error.kind !== "not-found") throw error;
        }
      }
      throw new ApiError("not-found", "Qualification not found.");
    },
    enabled: !!id,
    retry: shouldRetry,
    staleTime: 30_000,
  });
  const refetch = () => {
    void query.refetch();
  };

  if (!id) return { status: "not-found" };
  if (query.data) return { status: "ready", source: "api", lookup: query.data, refetch };
  if (query.isPending) return { status: "loading" };
  if (query.isError) {
    return { status: "error", error: toError(query.error), refetch };
  }
  return { status: "loading" };
}

export interface QualificationRow {
  lead: ApiLead;
  qualification: ApiQualification;
}

/** Client-side tier filter over fetched rows (no backend tier filter exists). */
export function filterQualificationRows(rows: QualificationRow[], tier: string): QualificationRow[] {
  if (tier === "All signals") return rows;
  return rows.filter((row) => row.qualification.tier === tier);
}

export interface QualificationRowsResult {
  rows: QualificationRow[];
  totalLeads: number;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<void>;
}

/**
 * Real qualification rows for the /qualifications list. The backend has no
 * list endpoint, so rows are derived honestly: real leads (page 1) crossed
 * with GET /api/v1/qualifications/leads/:leadId. Leads without a backend
 * record (404) contribute no row — never fabricated. Only leads-list
 * failure is page-level error; per-lead misses are normal.
 */
export function useQualificationRows(pageSize = 20, opts?: { enabled?: boolean }): QualificationRowsResult {
  const enabled = opts?.enabled ?? true;
  const leadsQuery = useLeadsQuery({ page: 1, limit: pageSize }, { enabled });
  const leads = enabled ? leadsQuery.data?.leads ?? [] : [];
  const lookups = useQueries({
    queries: leads.map((lead) => ({
      queryKey: qualificationKeys.byLead(lead.id),
      queryFn: () => getQualificationByLead(lead.id),
      retry: false,
      staleTime: 30_000,
    })),
  });
  const rows: QualificationRow[] = [];
  leads.forEach((lead, i) => {
    const qualification = lookups[i]?.data as ApiQualification | undefined;
    if (qualification) rows.push({ lead, qualification });
  });
  return {
    rows,
    totalLeads: leadsQuery.data?.total ?? 0,
    isPending: enabled && (leadsQuery.isPending || lookups.some((q) => q.isPending)),
    isError: enabled && leadsQuery.isError,
    error: leadsQuery.error,
    refetch: async () => {
      await leadsQuery.refetch();
      await Promise.all(lookups.map((q) => q.refetch()));
    },
  };
}
