/**
 * Phase 9 — React Query hooks for the text-conversation backend.
 *
 * Uses the shared QueryClient (via context — never creates a new one) and the
 * Phase 9 API service (never fetch/axios). All data renders from backend
 * records; nothing here invents messages, slots, scores, or meetings.
 *
 * Backend coverage (existing Express endpoints only):
 *   POST /api/v1/conversations                  -> useCreateConversationMutation
 *   GET  /api/v1/conversations                   -> useConversationsQuery
 *   GET  /api/v1/conversations/:id               -> useConversationQuery
 *   GET  /api/v1/conversations/:id/messages      -> useConversationMessagesQuery
 *   POST /api/v1/conversations/:id/messages      -> useSendConversationMessageMutation
 *   POST /api/v1/conversations/:id/complete      -> useCompleteConversationMutation
 *   POST /api/v1/conversations/:id/abandon       -> useAbandonConversationMutation
 *   GET  /api/v1/conversations/:id/state         -> useConversationStateQuery
 *   POST /api/v1/conversations/:id/qualification -> useQualifyConversationMutation
 *   GET  /api/v1/conversations/:id/qualification -> useConversationQualificationQuery
 *   GET  /api/v1/conversations/:id/calendar/availability -> useConversationAvailabilityQuery
 *   POST /api/v1/conversations/:id/calendar/book -> useBookConversationMeetingMutation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../errors";
import { leadKeys } from "./useLeads";
import {
  abandonConversation,
  bookConversationMeeting,
  completeConversation,
  createConversation,
  getConversation,
  getConversationAvailability,
  getConversationMessages,
  getConversationQualification,
  getConversationState,
  listConversations,
  qualifyConversation,
  sendConversationMessage,
} from "../services/conversations";
import type {
  BookConversationMeetingInput,
  ConversationAvailabilityQuery,
  ConversationListResult,
  CreateConversationInput,
  ListConversationsInput,
  Qualification,
} from "../types";

export const conversationKeys = {
  all: ["conversations"] as const,
  lists: () => [...conversationKeys.all, "list"] as const,
  list: (params: ListConversationsInput) => [...conversationKeys.lists(), params] as const,
  detail: (id: string) => [...conversationKeys.all, "detail", id] as const,
  messages: (id: string) => [...conversationKeys.all, "messages", id] as const,
  /**
   * Key for send-message mutations of one conversation. The MutationCache
   * (global, survives page unmount) is the durable source for in-flight and
   * failed sends — the detail page reads it via useIsMutating /
   * useMutationState so navigation never loses pending/error state.
   */
  sendMessage: (id: string) => [...conversationKeys.all, "send", id] as const,
  state: (id: string) => [...conversationKeys.all, "state", id] as const,
  qualification: (id: string) => [...conversationKeys.all, "qualification", id] as const,
  availability: (id: string, query: ConversationAvailabilityQuery) =>
    [...conversationKeys.all, "availability", id, query.start, query.end, query.timezone ?? ""] as const,
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

/** Paginated backend conversation list. Previous page stays visible while refetching. */
export function useConversationsQuery(params: ListConversationsInput, opts?: { enabled?: boolean }) {
  return useQuery<ConversationListResult>({
    queryKey: conversationKeys.list(params),
    queryFn: () => listConversations(params),
    retry: shouldRetry,
    staleTime: 15_000,
    placeholderData: (previousData) => previousData,
    enabled: opts?.enabled ?? true,
  });
}

/** Conversation record + linked lead summary + message count. */
export function useConversationQuery(id: string | undefined) {
  return useQuery({
    queryKey: conversationKeys.detail(id ?? ""),
    queryFn: () => getConversation(id as string),
    enabled: !!id,
    retry: shouldRetry,
    staleTime: 15_000,
    // Returning to the page must show the latest server truth (a send may
    // have completed while this page was unmounted).
    refetchOnMount: "always",
  });
}

/**
 * Chronological message history. Refetch (not a live subscription) is the
 * refresh mechanism; the send mutation below appends the persisted pair and
 * invalidates this query so ordering always comes from the backend.
 */
export function useConversationMessagesQuery(id: string | undefined, limit = 50) {
  return useQuery({
    queryKey: conversationKeys.messages(id ?? ""),
    queryFn: () => getConversationMessages(id as string, 1, limit),
    enabled: !!id,
    retry: shouldRetry,
    staleTime: 10_000,
    // History is server truth: always refetch on return so a result
    // persisted while away (or after a refresh) renders immediately.
    refetchOnMount: "always",
  });
}

/** Structured logistics slots (null until the backend records any). */
export function useConversationStateQuery(id: string | undefined) {
  return useQuery({
    queryKey: conversationKeys.state(id ?? ""),
    queryFn: () => getConversationState(id as string),
    enabled: !!id,
    retry: shouldRetry,
    staleTime: 15_000,
    // Tool-executed slot changes may have landed while away.
    refetchOnMount: "always",
  });
}

/**
 * Persisted qualification. 404 (never qualified yet) resolves to null data
 * via throwOnError:false handling by callers — the query itself stays in
 * error state so the panel can distinguish "none yet" from real failures.
 */
export function useConversationQualificationQuery(id: string | undefined) {
  return useQuery({
    queryKey: conversationKeys.qualification(id ?? ""),
    queryFn: () => getConversationQualification(id as string),
    enabled: !!id,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.kind === "not-found") return false;
      return shouldRetry(failureCount, error);
    },
    staleTime: 15_000,
    // Auto-qualification may have persisted while away.
    refetchOnMount: "always",
  });
}

/** Create a conversation (channel defaults to web server-side). */
export function useCreateConversationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConversationInput) => createConversation(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
    },
  });
}

/**
 * Send a message. On success the persisted user + assistant pair is appended
 * to the cached history in backend order, and detail/state/qualification
 * caches are refreshed (the response carries the conversation record and an
 * optional fresh qualification). No optimistic fake messages: the user
 * message renders only after the backend persists it. On failure nothing is
 * appended — the caller keeps the composed text for retry.
 */
export function useSendConversationMessageMutation(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // A send is never auto-retried: each attempt persists server-side, so a
    // blind retry could double rows. Retries go through the caller's explicit
    // Retry, reusing the same idempotency key (server replays, never dupes).
    retry: false,
    // Durable across unmounts: the page observes pending/failed sends for
    // this conversation through the global MutationCache, so navigating
    // away mid-processing loses neither the typing state nor the retry.
    mutationKey: conversationKeys.sendMessage(conversationId),
    mutationFn: (input: { content: string; idempotencyKey?: string }) =>
      sendConversationMessage(conversationId, input.content, input.idempotencyKey),
    onSuccess: (result) => {
      queryClient.setQueryData(
        conversationKeys.messages(conversationId),
        (previous: { messages: unknown[]; total: number; page: number; limit: number } | undefined) => {
          const base = previous ?? { messages: [], total: 0, page: 1, limit: 50 };
          return {
            ...base,
            messages: [...(base.messages as unknown[]), result.userMessage, result.assistantMessage],
            total: base.total + 2,
          };
        }
      );
      if (result.qualification) {
        queryClient.setQueryData(
          conversationKeys.qualification(conversationId),
          result.qualification as Qualification
        );
      }
      queryClient.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      queryClient.invalidateQueries({ queryKey: conversationKeys.state(conversationId) });
      queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
      // Phase 19 — a turn can progressively store contact details on the
      // linked lead: refresh its record (and any list showing it) as well.
      const linkedLeadId = result.conversation?.lead_id;
      if (typeof linkedLeadId === "string" && linkedLeadId.length > 0) {
        queryClient.invalidateQueries({ queryKey: leadKeys.detail(linkedLeadId) });
        queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
      }
    },
  });
}

/** Complete a conversation: refresh detail + lists; composer disables off status. */
export function useCompleteConversationMutation(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => completeConversation(conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
      queryClient.invalidateQueries({ queryKey: conversationKeys.qualification(conversationId) });
    },
  });
}

/** Abandon a conversation (same cache handling as complete). */
export function useAbandonConversationMutation(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => abandonConversation(conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
    },
  });
}

/** Manual (re)qualification. Seeds the qualification cache on success. */
export function useQualifyConversationMutation(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => qualifyConversation(conversationId),
    onSuccess: (qualification) => {
      queryClient.setQueryData(conversationKeys.qualification(conversationId), qualification);
    },
  });
}

/**
 * Explicit slot availability. Fires only when `params` is set (caller sets
 * it from an explicit "Check availability" action — never automatically).
 */
export function useConversationAvailabilityQuery(
  id: string | undefined,
  params: ConversationAvailabilityQuery | null
) {
  return useQuery({
    queryKey: conversationKeys.availability(
      id ?? "",
      params ?? { start: "", end: "", timezone: null }
    ),
    queryFn: () => getConversationAvailability(id as string, params as ConversationAvailabilityQuery),
    enabled: !!id && params !== null,
    retry: shouldRetry,
    staleTime: 30_000,
  });
}

/** Explicit booking. Sends only backend-supported fields. */
export function useBookConversationMeetingMutation(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BookConversationMeetingInput) =>
      bookConversationMeeting(conversationId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
    },
  });
}
