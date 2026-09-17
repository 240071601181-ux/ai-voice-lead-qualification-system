/**
 * Phase 14C-4 — React Query hooks for Leads backend integration.
 *
 * Uses the shared QueryClient from `@/api/queryClient` (via context — never
 * creates a new one) and the Phase 14C-3 API services (never fetch/axios).
 *
 * Backend coverage (existing Express endpoints only):
 *   GET   /api/v1/leads      -> useLeadsQuery (search/page/limit, paginated)
 *   GET   /api/v1/leads/:id  -> useLeadQuery / useLeadDetail
 *   POST  /api/v1/leads      -> useCreateLeadMutation
 *   PATCH /api/v1/leads/:id  -> useUpdateLeadMutation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../errors";
import { createLead, getLead, listLeads, updateLead } from "../services/leads";
import type { CreateLeadInput, Lead as ApiLead, LeadListResult, ListLeadsInput, UpdateLeadInput } from "../types";
import type { Lead as DisplayLead } from "@/mock/pipeline";
import { toDisplayLead } from "./leadDisplay";

export const leadKeys = {
  all: ["leads"] as const,
  lists: () => [...leadKeys.all, "list"] as const,
  list: (params: ListLeadsInput) => [...leadKeys.lists(), params] as const,
  detail: (id: string) => [...leadKeys.all, "detail", id] as const,
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

/** Paginated backend leads list. Previous page stays visible while refetching. */
export function useLeadsQuery(params: ListLeadsInput, opts?: { enabled?: boolean }) {
  return useQuery<LeadListResult>({
    queryKey: leadKeys.list(params),
    queryFn: () => listLeads(params),
    retry: shouldRetry,
    staleTime: 15_000,
    placeholderData: (previousData) => previousData,
    enabled: opts?.enabled ?? true,
  });
}

/** Raw backend lead query. Enabled only when an id is present. */
export function useLeadQuery(id: string | undefined) {
  return useQuery({
    queryKey: leadKeys.detail(id ?? ""),
    queryFn: () => getLead(id as string),
    enabled: !!id,
    retry: shouldRetry,
    staleTime: 30_000,
  });
}

export type LeadDetailResult =
  | { status: "loading" }
  | {
      status: "ready";
      /** 'api' = live backend record; 'mock' = demo fallback (backend lookup failed). */
      source: "api" | "mock";
      displayLead: DisplayLead;
      apiLead: ApiLead | null;
      /** Backend error that caused the mock fallback (null when source is 'api'). */
      apiError: ApiError | Error | null;
      refetch: () => void;
    }
  | { status: "not-found" }
  | { status: "error"; error: ApiError | Error; refetch: () => void };

/**
 * Detail resolution with mock fallback.
 *
 * Always requests the real backend lead first. When the backend lookup fails
 * but the id matches a known demo lead, the demo lead is shown (with the
 * backend error exposed so the UI can badge it as demo data). Genuine
 * backend ids (e.g. UUIDs returned by POST /leads) surface true
 * loading / not-found / error states.
 */
export function useLeadDetail(id: string | undefined, fallback?: DisplayLead): LeadDetailResult {
  const query = useLeadQuery(id);
  const refetch = () => {
    void query.refetch();
  };

  if (!id) return { status: "not-found" };
  if (query.data) {
    return {
      status: "ready",
      source: "api",
      displayLead: toDisplayLead(query.data),
      apiLead: query.data,
      apiError: null,
      refetch,
    };
  }
  if (query.isPending) return { status: "loading" };
  if (query.isError) {
    if (fallback) {
      return {
        status: "ready",
        source: "mock",
        displayLead: fallback,
        apiLead: null,
        apiError: toError(query.error),
        refetch,
      };
    }
    if (query.error instanceof ApiError && query.error.kind === "not-found") {
      return { status: "not-found" };
    }
    return { status: "error", error: toError(query.error), refetch };
  }
  return { status: "loading" };
}

export function useCreateLeadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLeadInput) => createLead(input),
    onSuccess: (lead) => {
      // Seed the detail cache so the post-create navigation renders instantly,
      // then let the detail page refetch the authoritative record.
      queryClient.setQueryData(leadKeys.detail(lead.id), lead);
      // Refetch the live leads list so the new lead appears there too.
      queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useUpdateLeadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateLeadInput }) => updateLead(id, data),
    onSuccess: (lead) => {
      queryClient.setQueryData(leadKeys.detail(lead.id), lead);
      queryClient.invalidateQueries({ queryKey: leadKeys.detail(lead.id) });
    },
  });
}
