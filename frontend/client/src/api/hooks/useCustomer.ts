/**
 * Phase 20 — React Query hooks for the external customer chat.
 *
 * Separate cache keys (["customer", ...]) from the internal conversation
 * hooks so an admin and a customer sharing one browser profile can never
 * read each other's cached rows. No optimistic fake messages: renders wait
 * for persisted server rows, same as the internal composer.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../errors";
import {
  bookCustomerMeeting,
  getCustomerAvailability,
  getCustomerConversation,
  getCustomerMessages,
  getCustomerQualification,
  getCustomerState,
  logoutCustomer,
  redeemCustomerSession,
  sendCustomerMessage,
} from "../services/customer";
import type {
  BookConversationMeetingInput,
  ConversationAvailabilityQuery,
} from "../types";

export const customerKeys = {
  all: ["customer"] as const,
  conversation: () => [...customerKeys.all, "conversation"] as const,
  messages: () => [...customerKeys.all, "messages"] as const,
  state: () => [...customerKeys.all, "state"] as const,
  qualification: () => [...customerKeys.all, "qualification"] as const,
  availability: (query: ConversationAvailabilityQuery) =>
    [...customerKeys.all, "availability", query.start, query.end, query.timezone ?? ""] as const,
};

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && (error.kind === "not-found" || error.kind === "unauthorized")) {
    return false;
  }
  return failureCount < 1;
}

/** Probe for an ambient customer session (used by route guards only). */
export function useCustomerSessionProbe(enabled: boolean) {
  return useQuery({
    queryKey: customerKeys.conversation(),
    queryFn: () => getCustomerConversation(),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useCustomerConversationQuery(enabled = true) {
  return useQuery({
    queryKey: customerKeys.conversation(),
    queryFn: () => getCustomerConversation(),
    enabled,
    retry: shouldRetry,
    staleTime: 15_000,
    refetchOnMount: "always",
  });
}

export function useCustomerMessagesQuery(enabled = true, limit = 100) {
  return useQuery({
    queryKey: customerKeys.messages(),
    queryFn: () => getCustomerMessages(1, limit),
    enabled,
    retry: shouldRetry,
    staleTime: 10_000,
    refetchOnMount: "always",
  });
}

export function useCustomerStateQuery(enabled = true) {
  return useQuery({
    queryKey: customerKeys.state(),
    queryFn: () => getCustomerState(),
    enabled,
    retry: shouldRetry,
    staleTime: 15_000,
    refetchOnMount: "always",
  });
}

export function useCustomerQualificationQuery(enabled = true) {
  return useQuery({
    queryKey: customerKeys.qualification(),
    queryFn: () => getCustomerQualification(),
    enabled,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.kind === "not-found") return false;
      return shouldRetry(failureCount, error);
    },
    staleTime: 15_000,
    refetchOnMount: "always",
  });
}

/** Customer send: never auto-retried; explicit retry reuses the key. */
export function useSendCustomerMessageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationKey: [...customerKeys.all, "send"] as const,
    mutationFn: (input: { content: string; idempotencyKey?: string }) =>
      sendCustomerMessage(input.content, input.idempotencyKey),
    onSuccess: (result) => {
      queryClient.setQueryData(
        customerKeys.messages(),
        (previous: { messages: unknown[]; total: number; page: number; limit: number } | undefined) => {
          const base = previous ?? { messages: [], total: 0, page: 1, limit: 100 };
          return {
            ...base,
            messages: [...(base.messages as unknown[]), result.userMessage, result.assistantMessage],
            total: base.total + 2,
          };
        }
      );
      if (result.qualification) {
        queryClient.setQueryData(customerKeys.qualification(), result.qualification);
      }
      queryClient.invalidateQueries({ queryKey: customerKeys.conversation() });
      queryClient.invalidateQueries({ queryKey: customerKeys.state() });
    },
  });
}

export function useRedeemCustomerSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accessToken: string) => redeemCustomerSession(accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useCustomerLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => logoutCustomer(),
    onSettled: () => {
      queryClient.removeQueries({ queryKey: customerKeys.all });
    },
  });
}

/** Meeting hooks shaped for the shared MeetingPanel `hooks` prop. */
export function useCustomerAvailabilityQuery(params: ConversationAvailabilityQuery | null) {
  return useQuery({
    queryKey: customerKeys.availability(params ?? { start: "", end: "", timezone: null }),
    queryFn: () => getCustomerAvailability(params as ConversationAvailabilityQuery),
    enabled: params !== null,
    retry: shouldRetry,
    staleTime: 30_000,
  });
}

export function useBookCustomerMeetingMutation() {
  return useMutation({
    mutationFn: (input: BookConversationMeetingInput) => bookCustomerMeeting(input),
  });
}

export const customerMeetingHooks = {
  useAvailability: (_conversationId: string, params: ConversationAvailabilityQuery | null) =>
    useCustomerAvailabilityQuery(params),
  useBook: (_conversationId: string) => useBookCustomerMeetingMutation(),
};
