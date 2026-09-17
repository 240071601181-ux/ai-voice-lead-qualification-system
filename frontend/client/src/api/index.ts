/**
 * Phase 14C-3 — Public entry point for the frontend API layer.
 *
 * Architecture:
 *   React Page -> React Hook / Service -> API Client -> HTTP -> Express backend
 *
 * Components must import from "@/api" (never fetch/axios directly).
 * Mock services (`@/mock/*`) and real API services (`@/api/*`) stay
 * separate; `VITE_USE_MOCK_DATA` decides which a page uses (future phases).
 */

export { frontendEnv, isMockDataEnabled } from "./env";
export { httpClient, request } from "./httpClient";
export type { HttpMethod, RequestOptions } from "./httpClient";
export { ApiError, errorKindForStatus, getCalendarBookingErrorMessage, getStartCallErrorMessage, getUserMessage, CALENDAR_BOOKING_NOT_CONFIGURED_MESSAGE, TELEPHONY_NOT_CONFIGURED_MESSAGE } from "./errors";
export type { ApiErrorKind } from "./errors";
export { queryClient } from "./queryClient";
export { errorState, fromQuery, idleState, loadingState, successState } from "./asyncState";
export type { AsyncState, AsyncStatus } from "./asyncState";
export type * from "./types";

export * as leadsApi from "./services/leads";
export * as callsApi from "./services/calls";
export * as conversationsApi from "./services/conversations";
export { getChatToken, setChatToken, clearChatToken, getChatAuthHeader } from "./chatToken";
export * as agentApi from "./services/agent";
export * as leadsHooks from "./hooks/useLeads";
export * as callsHooks from "./hooks/useCalls";
export * as conversationsHooks from "./hooks/useConversations";
export * as qualificationsHooks from "./hooks/useQualifications";
export * as followupsHooks from "./hooks/useFollowups";
export * as calendarHooks from "./hooks/useCalendar";
export * as knowledgeHooks from "./hooks/useKnowledge";
export * as knowledgeApi from "./services/knowledge";
export * as qualificationsApi from "./services/qualifications";
export * as followupsApi from "./services/followups";
export * as calendarApi from "./services/calendar";
export * as healthApi from "./services/health";
