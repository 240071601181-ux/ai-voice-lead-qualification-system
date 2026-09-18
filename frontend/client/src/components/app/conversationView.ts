/**
 * Phase 9 — Pure view helpers for the text-conversation UI (no React).
 *
 * Kept DOM-free so the conversation screen's display rules are unit
 * testable under the node vitest environment: chronological ordering,
 * internal-message filtering, user-safe error copy, tier presentation, and
 * composer gating. Components only render what these helpers return.
 */

import { ApiError } from "@/api/errors";
import type {
  ConversationMessage,
  ConversationState,
  ConversationStatus,
  QualificationTier,
} from "@/api/types";

/** Roles the chat UI may render. System prompts and tool internals never display. */
export type VisibleMessageRole = "user" | "assistant";

export interface VisibleMessage {
  id: string;
  role: VisibleMessageRole;
  content: string;
  created_at: string;
}

/**
 * Backend history → chat bubbles: drop system/tool/internal rows (never
 * display tool calls, SQL, prompts, or raw metadata), keep user/assistant in
 * chronological order.
 */
export function toVisibleMessages(messages: ConversationMessage[]): VisibleMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice()
    .sort((a, b) => {
      const at = new Date(a.created_at).getTime();
      const bt = new Date(b.created_at).getTime();
      if (at !== bt) return at - bt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((m) => ({
      id: m.id,
      role: m.role as VisibleMessageRole,
      content: m.content,
      created_at: m.created_at,
    }));
}

export const NO_CONVERSATIONS_COPY = "No conversations yet.";

/** User-safe send/assistant-failure copy. Never leaks internals. */
export function conversationErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case "unauthorized":
        return "You are signed out. Please sign in again.";
      case "forbidden":
        return "You don't have permission to perform this action.";
      case "not-found":
        return "This conversation was not found. It may have been removed.";
      case "conflict":
        return "This conversation is no longer active.";
      case "rate-limited":
        return "Too many messages. Please wait a moment.";
      case "bad-request":
        return error.message || "Some details look invalid. Review and retry.";
      case "unavailable":
      case "server":
        return "Something went wrong while generating the response.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}

/** Composer is usable only while the conversation is active. */
export function isComposerDisabled(status: ConversationStatus | undefined): boolean {
  return status !== "active";
}

/** Human label for a conversation status. Never invents new states. */
export function formatStatusLabel(status: ConversationStatus | string | undefined | null): string {
  if (!status) return "Unknown";
  const s = String(status).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Chat-bubble alignment for a visible role. System rows never reach the UI. */
export function messageAlignment(role: VisibleMessageRole | string): "left" | "right" {
  return role === "user" ? "right" : "left";
}

/** Whether the "messaging disabled" note should render for a status. */
export function shouldShowComposerDisabledNote(status: ConversationStatus | undefined): boolean {
  return status !== undefined && status !== "active";
}

export const QUALIFICATION_EMPTY_COPY =
  "Not scored yet. Qualification appears automatically once enough details are known.";

export const LOGISTICS_EMPTY_COPY = "No structured logistics details yet.";

/** Tier badge copy. Unknown values render neutrally (never invented). */
export function tierBadgeCopy(tier: QualificationTier | null | undefined): string {
  if (tier === "HOT" || tier === "WARM" || tier === "COLD") return tier;
  return "Unqualified";
}

export interface LogisticsStateRow {
  label: string;
  value: string;
}

const textOrDash = (value: unknown): string => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return "—";
};

/** Backend state row → panel rows. No extraction logic lives here. */
export function toLogisticsStateRows(state: ConversationState | null | undefined): LogisticsStateRow[] {
  if (!state) return [];
  const weight =
    typeof state.cargo_weight === "number" || (typeof state.cargo_weight === "string" && state.cargo_weight.trim())
      ? `${String(state.cargo_weight).trim()} kg`
      : "—";
  const budget =
    typeof state.budget === "number" || (typeof state.budget === "string" && state.budget.trim())
      ? `₹${String(state.budget).trim()}`
      : "—";
  return [
    { label: "Customer", value: textOrDash(state.customer_name) },
    { label: "Pickup", value: textOrDash(state.pickup_location) },
    { label: "Destination", value: textOrDash(state.destination) },
    { label: "Vehicle", value: textOrDash(state.vehicle_type) },
    { label: "Cargo", value: textOrDash(state.cargo_type) },
    { label: "Weight", value: weight },
    { label: "Dimensions", value: textOrDash(state.cargo_dimensions) },
    { label: "Required date", value: textOrDash(state.required_date) },
    { label: "Budget", value: budget },
    { label: "Urgency", value: textOrDash(state.urgency) },
    { label: "Booking intent", value: textOrDash(state.booking_intent) },
    { label: "Notes", value: textOrDash(state.additional_requirements) },
  ];
}

/** Short human timestamp for a message bubble (locale time + date when old). */
export function formatMessageTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
