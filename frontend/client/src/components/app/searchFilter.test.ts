/**
 * Phase 10 — Search filter tests (pure, no DOM).
 *
 * Verifies global-search matching over real backend records: conversations
 * by id/lead/channel/status and qualifications by id/tier/score/lead, with
 * empty queries matching nothing and limits respected.
 */
import { describe, expect, it } from "vitest";
import { filterConversationRecords, filterQualificationRecords } from "@/components/app/searchFilter";
import type { Conversation, Qualification } from "@/api/types";

const conv = (overrides: Partial<Conversation> & { id: string }): Conversation => ({
  channel: "web",
  status: "active",
  created_at: "2026-09-17T10:00:00.000Z",
  updated_at: "2026-09-17T10:00:00.000Z",
  ...overrides,
});

const qual = (overrides: Partial<Qualification> & { id: string }): Qualification => ({
  call_id: null,
  lead_id: "lead-1",
  score: 90,
  tier: "HOT",
  details: {
    criteria: {} as Qualification["details"]["criteria"],
    totalScore: 90,
    qualifiedAt: "2026-09-17T10:00:00.000Z",
  },
  qualified_at: "2026-09-17T10:00:00.000Z",
  created_at: "2026-09-17T10:00:00.000Z",
  updated_at: "2026-09-17T10:00:00.000Z",
  ...overrides,
});

describe("filterConversationRecords", () => {
  const records = [
    conv({ id: "conv-aaa", lead_id: "lead-1", channel: "web", status: "active" }),
    conv({ id: "conv-bbb", lead_id: null, channel: "whatsapp", status: "completed" }),
  ];

  it("matches id, lead, channel, and status case-insensitively", () => {
    expect(filterConversationRecords(records, "conv-aaa").map((h) => h.id)).toEqual(["conv-aaa"]);
    expect(filterConversationRecords(records, "LEAD-1").map((h) => h.id)).toEqual(["conv-aaa"]);
    expect(filterConversationRecords(records, "whatsapp").map((h) => h.id)).toEqual(["conv-bbb"]);
    expect(filterConversationRecords(records, "completed").map((h) => h.id)).toEqual(["conv-bbb"]);
    expect(filterConversationRecords(records, "nope")).toEqual([]);
    expect(filterConversationRecords(records, "   ")).toEqual([]);
  });

  it("respects the limit and shapes hits for the palette", () => {
    const many = Array.from({ length: 10 }, (_, i) => conv({ id: `conv-${i}` }));
    expect(filterConversationRecords(many, "conv", 5)).toHaveLength(5);
    const [hit] = filterConversationRecords(records, "conv-aaa");
    expect(hit.title).toBe("Lead lead-1");
    expect(hit.subtitle).toBe("conv-aaa");
    expect(hit.meta).toBe("web · active");
  });
});

describe("filterQualificationRecords", () => {
  const records = [
    qual({ id: "q-1", tier: "HOT", score: 90, lead_id: "lead-1", conversation_id: "conv-1" }),
    qual({ id: "q-2", tier: "COLD", score: 10, lead_id: "lead-2", call_id: "call-9" }),
  ];

  it("matches tier, score, lead, and anchors", () => {
    expect(filterQualificationRecords(records, "hot").map((h) => h.id)).toEqual(["q-1"]);
    expect(filterQualificationRecords(records, "10").map((h) => h.id)).toEqual(["q-2"]);
    expect(filterQualificationRecords(records, "lead-2").map((h) => h.id)).toEqual(["q-2"]);
    expect(filterQualificationRecords(records, "conv-1").map((h) => h.id)).toEqual(["q-1"]);
    expect(filterQualificationRecords(records, "zzz")).toEqual([]);
    expect(filterQualificationRecords(records, "")).toEqual([]);
  });

  it("labels conversation vs call anchors", () => {
    const [hot] = filterQualificationRecords(records, "q-1");
    expect(hot.title).toBe("HOT · 90");
    expect(hot.meta).toBe("conversation");
    const [cold] = filterQualificationRecords(records, "q-2");
    expect(cold.meta).toBe("call");
  });
});
