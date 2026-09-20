/**
 * Phase 9 — Conversation API service.
 * Phase 11 — authenticated via the backend session (no pasted tokens).
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
 * Auth: the short-lived session access token (see `api/session.ts`),
 * refreshed once-and-retried via `authedRequest`. The shared httpClient
 * still supplies the session cookie as before.
 */

import { authedRequest } from "../session";
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

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

export function createConversation(data: CreateConversationInput = {}): Promise<Conversation> {
  return authed((headers) => httpClient.post<Conversation>("/api/v1/conversations", data, { headers }));
}

export function listConversations(params: ListConversationsInput = {}): Promise<ConversationListResult> {
  return authed((headers) =>
    httpClient.get<ConversationListResult>("/api/v1/conversations", {
      headers,
      query: {
        leadId: params.leadId || undefined,
        status: params.status || undefined,
        channel: params.channel || undefined,
        page: params.page,
        limit: params.limit,
      },
    })
  );
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return authed((headers) =>
    httpClient.get<ConversationDetail>(`/api/v1/conversations/${encodeURIComponent(id)}`, { headers })
  );
}

export function getConversationMessages(
  id: string,
  page = 1,
  limit = 50
): Promise<ConversationMessageListResult> {
  return authed((headers) =>
    httpClient.get<ConversationMessageListResult>(
      `/api/v1/conversations/${encodeURIComponent(id)}/messages`,
      { headers, query: { page, limit } }
    )
  );
}

export function sendConversationMessage(
  id: string,
  content: string,
  idempotencyKey?: string
): Promise<SendConversationMessageResult> {
  return authed((headers) =>
    httpClient.post<SendConversationMessageResult>(
      `/api/v1/conversations/${encodeURIComponent(id)}/messages`,
      { content },
      {
        headers: {
          ...headers,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        // Measured 2026-09: local-Ollama turns take ~30s (English) and
        // 60-135s (Tamil multi-round tool turns). This must exceed the
        // backend per-call cap (LLM_TIMEOUT_MS, default 90s) across tool
        // rounds, or slow-but-healthy turns surface as client timeouts
        // while the server still persists both messages.
        timeoutMs: 180000,
      }
    )
  );
}

export function completeConversation(id: string): Promise<Conversation> {
  return authed((headers) =>
    httpClient.post<Conversation>(
      `/api/v1/conversations/${encodeURIComponent(id)}/complete`,
      {},
      { headers }
    )
  );
}

export function abandonConversation(id: string): Promise<Conversation> {
  return authed((headers) =>
    httpClient.post<Conversation>(
      `/api/v1/conversations/${encodeURIComponent(id)}/abandon`,
      {},
      { headers }
    )
  );
}

export function getConversationState(id: string): Promise<ConversationState | null> {
  return authed((headers) =>
    httpClient.get<ConversationState | null>(
      `/api/v1/conversations/${encodeURIComponent(id)}/state`,
      { headers }
    )
  );
}

export function qualifyConversation(id: string): Promise<Qualification> {
  return authed((headers) =>
    httpClient.post<Qualification>(
      `/api/v1/conversations/${encodeURIComponent(id)}/qualification`,
      {},
      { headers }
    )
  );
}

export function getConversationQualification(id: string): Promise<Qualification> {
  return authed((headers) =>
    httpClient.get<Qualification>(
      `/api/v1/conversations/${encodeURIComponent(id)}/qualification`,
      { headers }
    )
  );
}

export function getConversationAvailability(
  id: string,
  query: ConversationAvailabilityQuery
): Promise<ConversationAvailabilityResult> {
  return authed((headers) =>
    httpClient.get<ConversationAvailabilityResult>(
      `/api/v1/conversations/${encodeURIComponent(id)}/calendar/availability`,
      {
        headers,
        query: {
          start: query.start,
          end: query.end,
          timezone: query.timezone ?? undefined,
        },
      }
    )
  );
}

export function bookConversationMeeting(
  id: string,
  data: BookConversationMeetingInput
): Promise<ConversationBooking> {
  return authed((headers) =>
    httpClient.post<ConversationBooking>(
      `/api/v1/conversations/${encodeURIComponent(id)}/calendar/book`,
      data,
      { headers }
    )
  );
}
