/**
 * Phase 14C-4 — Backend Lead -> display-Lead adapter.
 *
 * The backend Lead carries profile fields only (id, source, name, phone,
 * email, status, created_at, updated_at). The existing Leads UI renders a
 * richer display shape (company, route, vehicle, tier, score, ...). This
 * adapter bridges the two WITHOUT inventing backend fields: unknown
 * display-only slots are filled with explicit "—" placeholders, and the
 * detail page badges api-sourced leads so placeholders are never mistaken
 * for real signal.
 */

import type { Lead as ApiLead } from "../types";
import type { Lead as DisplayLead } from "@/mock/pipeline";

export function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => (p[0] ?? "").toUpperCase());
  return letters.join("") || "—";
}

export function toDisplayLead(api: ApiLead): DisplayLead {
  return {
    id: api.id,
    initials: initialsForName(api.name),
    name: api.name,
    // Display-only slot: backend has no company field; email/source is the
    // closest real identifier. Never sent back to the backend.
    company: api.email ?? (api.source ? `Source: ${api.source}` : "—"),
    phone: api.phone,
    route: "—",
    vehicle: "—",
    cargo: "—",
    budget: "—",
    // No backend score/tier exists per lead: mark the signal unknown so the
    // list renders "—" instead of a fabricated badge. Real tier/score come
    // only from persisted per-conversation qualifications.
    tier: "WARM",
    score: 0,
    signalUnknown: true,
    status: api.status || "New",
    last: "—",
    created: api.created_at,
    color: "#38bdf8",
  };
}
