/**
 * Phase 20 — customer (external chat) API service.
 *
 * The customer authenticates with the HttpOnly session cookie ONLY
 * (credentials: "include" is already set in httpClient). These calls never
 * use the internal session (no authedRequest, no login requirement): on a
 * customer-only browser there is no internal token, and on a shared browser
 * the backend ignores Authorization on /api/v1/customer/* by design.
 */

import { httpClient } from "../httpClient";
import type {
  BookConversationMeetingInput,
  ConversationAvailabilityQuery,
  ConversationAvailabilityResult,
  ConversationBooking,
  ConversationMessageListResult,
  ConversationState,
  Qualification,
  SendConversationMessageResult,
} from "../types";

export interface CustomerConversation {
  id: string;
  status: string;
  channel: string;
}

export interface CustomerSessionResult {
  conversation: CustomerConversation;
  expiresAt: string;
}

export function redeemCustomerSession(accessToken: string): Promise<CustomerSessionResult> {
  return httpClient.post<CustomerSessionResult>(
    "/api/v1/customer/session",
    { accessToken },
    {
      // Redeeming is the one customer call that must never be confused
      // with a slow model turn: fail fast so the UI can show retry.
      timeoutMs: 30000,
    }
  );
}

export function getCustomerConversation(): Promise<CustomerConversation> {
  return httpClient.get<CustomerConversation>("/api/v1/customer/conversation");
}

export function getCustomerMessages(page = 1, limit = 50): Promise<ConversationMessageListResult> {
  return httpClient.get<ConversationMessageListResult>("/api/v1/customer/messages", {
    query: { page, limit },
  });
}

export function sendCustomerMessage(
  content: string,
  idempotencyKey?: string
): Promise<SendConversationMessageResult> {
  return httpClient.post<SendConversationMessageResult>(
    "/api/v1/customer/messages",
    { content },
    {
      headers: {
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      // Same budget as the internal send: local model turns are slow.
      timeoutMs: 180000,
    }
  );
}

export function getCustomerState(): Promise<ConversationState | null> {
  return httpClient.get<ConversationState | null>("/api/v1/customer/state");
}

export function getCustomerQualification(): Promise<Qualification> {
  return httpClient.get<Qualification>("/api/v1/customer/qualification");
}

export function getCustomerAvailability(
  query: ConversationAvailabilityQuery
): Promise<ConversationAvailabilityResult> {
  return httpClient.get<ConversationAvailabilityResult>(
    "/api/v1/customer/meeting/availability",
    {
      query: {
        start: query.start,
        end: query.end,
        timezone: query.timezone ?? undefined,
      },
    }
  );
}

export function bookCustomerMeeting(data: BookConversationMeetingInput): Promise<ConversationBooking> {
  return httpClient.post<ConversationBooking>("/api/v1/customer/meeting/book", data);
}

export function logoutCustomer(): Promise<{ loggedOut: boolean }> {
  return httpClient.post<{ loggedOut: boolean }>("/api/v1/customer/logout", {});
}
