/**
 * Phase 10 — Pure record filters for global search (no React).
 *
 * Backend list endpoints have no text search, so the palette fetches recent
 * rows live and filters them here. Only backend fields are matched — nothing
 * is fabricated, and stale hardcoded entries have no place in these helpers.
 */
import type { Conversation, Qualification } from "@/api/types";

export interface ConversationHit {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
}

export interface QualificationHit {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
}

/** Client-side match over id/lead/channel/status (backend has no text search). */
export function filterConversationRecords(
  records: Conversation[],
  query: string,
  limit = 5
): ConversationHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return records
    .filter((c) =>
      `${c.id} ${c.lead_id ?? ""} ${c.channel} ${c.status}`.toLowerCase().includes(q)
    )
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      title: c.lead_id ? `Lead ${c.lead_id.slice(0, 8)}` : "No lead",
      subtitle: c.id,
      meta: [c.channel, c.status].filter(Boolean).join(" · "),
    }));
}

/** Client-side match over id/tier/score/lead (backend has no text search). */
export function filterQualificationRecords(
  records: Qualification[],
  query: string,
  limit = 5
): QualificationHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return records
    .filter((record) =>
      `${record.id} ${record.tier} ${record.score} ${record.lead_id ?? ""} ${
        record.conversation_id ?? ""
      } ${record.call_id ?? ""}`.toLowerCase().includes(q)
    )
    .slice(0, limit)
    .map((record) => ({
      id: record.id,
      title: `${record.tier} · ${record.score}`,
      subtitle: record.lead_id ? `Lead ${record.lead_id.slice(0, 8)}` : record.id,
      meta: record.conversation_id ? "conversation" : record.call_id ? "call" : "",
    }));
}
