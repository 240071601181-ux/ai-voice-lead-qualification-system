/**
 * Phase 9 — Conversation API service.
 *
 * Backend routes (existing Express backend, DO NOT MODIFY):
 *   POST /api/v1/conversations                          { leadId?, channel? }
 *   GET  /api/v1/conversations                          (leadId/status/channel/page/limit)
 *   GET  /api/v1/conversations/:id
 *   GET  /api/v1/conversations/:id/messages             (page/limit)
 *   POST /api/v1/conversations/:id/messages             { content }
 *   POST /api/v1/conversations/:id/complete
 *   POST /api/v1/conversations/:id/abandon
 *   GET  /api/v1/conversations/:id/state
 *   POST /api/v1/conversations/:id/qualification
 *   GET  /api/v1/conversations/:id/qualification
 *   GET  /api/v1/conversations/:id/calendar/availability (start/end/timezone)
 *   POST /api/v1/conversations/:id/calendar/book         (start/end/...)
 *
 * Auth: these routes require the CHAT_JWT Bearer token (see
 * `api/chatToken.ts`), which is unrelated to the platform session cookie.
 * Every function below attaches it via per-request headers; the shared
 * httpClient still supplies the session cookie as before.
 */

import { getChatAuthHeader } from "../chatToken";
import { httpClient } from "../httpClient";
import type {
  BookConversationMeetingInput,
  Conversation,
  ConversationAvailabilityQuery,
  ConversationAvailabilityResult,
  ConversationBooking,
  ConversationDetail,
  ConversationListResult,
  ConversationMessageListResult,
  ConversationState,
  CreateConversationInput,
  ListConversationsInput,
  Qualification,
  SendConversationMessageResult,
} from "../types";

function authHeaders(): Record<string, string> {
  return getChatAuthHeader();
}

export function createConversation(data: CreateConversationInput = {}): Promise<Conversation> {
  return httpClient.post<Conversation>("/api/v1/conversations", data, {
    headers: authHeaders(),
  });
}

export function listConversations(params: ListConversationsInput = {}): Promise<ConversationListResult> {
  return httpClient.get<ConversationListResult>("/api/v1/conversations", {
    headers: authHeaders(),
    query: {
      leadId: params.leadId || undefined,
      status: params.status || undefined,
      channel: params.channel || undefined,
      page: params.page,
      limit: params.limit,
    },
  });
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return httpClient.get<ConversationDetail>(`/api/v1/conversations/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
}

export function getConversationMessages(
  id: string,
  page = 1,
  limit = 50
): Promise<ConversationMessageListResult> {
  return httpClient.get<ConversationMessageListResult>(
    `/api/v1/conversations/${encodeURIComponent(id)}/messages`,
    { headers: authHeaders(), query: { page, limit } }
  );
}

export function sendConversationMessage(
  id: string,
  content: string
): Promise<SendConversationMessageResult> {
  return httpClient.post<SendConversationMessageResult>(
    `/api/v1/conversations/${encodeURIComponent(id)}/messages`,
    { content },
    { headers: authHeaders(), timeoutMs: 60000 }
  );
}

export function completeConversation(id: string): Promise<Conversation> {
  return httpClient.post<Conversation>(
    `/api/v1/conversations/${encodeURIComponent(id)}/complete`,
    {},
    { headers: authHeaders() }
  );
}

export function abandonConversation(id: string): Promise<Conversation> {
  return httpClient.post<Conversation>(
    `/api/v1/conversations/${encodeURIComponent(id)}/abandon`,
    {},
    { headers: authHeaders() }
  );
}

export function getConversationState(id: string): Promise<ConversationState | null> {
  return httpClient.get<ConversationState | null>(
    `/api/v1/conversations/${encodeURIComponent(id)}/state`,
    { headers: authHeaders() }
  );
}

export function qualifyConversation(id: string): Promise<Qualification> {
  return httpClient.post<Qualification>(
    `/api/v1/conversations/${encodeURIComponent(id)}/qualification`,
    {},
    { headers: authHeaders() }
  );
}

export function getConversationQualification(id: string): Promise<Qualification> {
  return httpClient.get<Qualification>(
    `/api/v1/conversations/${encodeURIComponent(id)}/qualification`,
    { headers: authHeaders() }
  );
}

export function getConversationAvailability(
  id: string,
  query: ConversationAvailabilityQuery
): Promise<ConversationAvailabilityResult> {
  return httpClient.get<ConversationAvailabilityResult>(
    `/api/v1/conversations/${encodeURIComponent(id)}/calendar/availability`,
    {
      headers: authHeaders(),
      query: {
        start: query.start,
        end: query.end,
        timezone: query.timezone ?? undefined,
      },
    }
  );
}

export function bookConversationMeeting(
  id: string,
  data: BookConversationMeetingInput
): Promise<ConversationBooking> {
  return httpClient.post<ConversationBooking>(
    `/api/v1/conversations/${encodeURIComponent(id)}/calendar/book`,
    data,
    { headers: authHeaders() }
  );
}
