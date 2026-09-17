/**
 * Phase 9 — Conversation view-helper tests (pure, no DOM).
 *
 * Covers the display rules the screens depend on: chronological ordering,
 * internal-message filtering, safe error copy per status, composer gating,
 * tier copy, logistics rows, and the empty-state constant.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/errors";
import {
  NO_CONVERSATIONS_COPY,
  conversationErrorCopy,
  formatMessageTime,
  isComposerDisabled,
  tierBadgeCopy,
  toLogisticsStateRows,
  toVisibleMessages,
} from "@/components/app/conversationView";
import type { ConversationMessage } from "@/api/types";

const msg = (overrides: Partial<ConversationMessage> & { id: string }): ConversationMessage => ({
  conversation_id: "conv-1",
  role: "user",
  content: "x",
  created_at: "2026-09-17T10:00:00.000Z",
  ...overrides,
});

describe("toVisibleMessages", () => {
  it("keeps user/assistant in chronological order and drops system/tool rows", () => {
    const out = toVisibleMessages([
      msg({ id: "m3", role: "assistant", content: "bye", created_at: "2026-09-17T10:02:00.000Z" }),
      msg({ id: "m0", role: "system", content: "prompt" }),
      msg({ id: "m2", role: "tool", content: "{\"a\":1}" }),
      msg({ id: "m1", role: "user", content: "hi", created_at: "2026-09-17T10:01:00.000Z" }),
    ]);
    expect(out.map((m) => m.id)).toEqual(["m1", "m3"]);
    expect(out.every((m) => m.role === "user" || m.role === "assistant")).toBe(true);
  });

  it("never exposes metadata or tool payloads", () => {
    const out = toVisibleMessages([
      msg({ id: "m1", role: "assistant", content: "ok", metadata: { toolsExecuted: [] }, tool_calls: [{ id: "t" }] }),
    ]);
    expect(out[0]).toEqual({
      id: "m1",
      role: "assistant",
      content: "ok",
      created_at: "2026-09-17T10:00:00.000Z",
    });
  });
});

describe("conversationErrorCopy", () => {
  it("maps statuses to the required user-safe messages", () => {
    expect(conversationErrorCopy(new ApiError("unauthorized", "x"))).toBe("You are signed out. Please sign in again.");
    expect(conversationErrorCopy(new ApiError("conflict", "x"))).toBe("This conversation is no longer active.");
    expect(conversationErrorCopy(new ApiError("rate-limited", "x"))).toBe("Too many messages. Please wait a moment.");
    expect(conversationErrorCopy(new ApiError("server", "x"))).toBe("Something went wrong while generating the response.");
    expect(conversationErrorCopy(new ApiError("not-found", "x"))).toContain("not found");
    expect(conversationErrorCopy(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});

describe("composer gating and misc copy", () => {
  it("disables the composer unless the conversation is active", () => {
    expect(isComposerDisabled("active")).toBe(false);
    expect(isComposerDisabled("completed")).toBe(true);
    expect(isComposerDisabled("abandoned")).toBe(true);
    expect(isComposerDisabled(undefined)).toBe(true);
  });

  it("renders tier copy without inventing tiers", () => {
    expect(tierBadgeCopy("HOT")).toBe("HOT");
    expect(tierBadgeCopy("WARM")).toBe("WARM");
    expect(tierBadgeCopy("COLD")).toBe("COLD");
    expect(tierBadgeCopy(null)).toBe("Unqualified");
    expect(tierBadgeCopy(undefined)).toBe("Unqualified");
  });

  it("uses the exact empty-state copy", () => {
    expect(NO_CONVERSATIONS_COPY).toBe("No conversations yet.");
  });

  it("formats message timestamps without crashing on bad input", () => {
    expect(formatMessageTime("2026-09-17T10:00:00.000Z", new Date("2026-09-17T12:00:00.000Z"))).toMatch(/\d{1,2}:\d{2}/);
    expect(formatMessageTime("garbage")).toBe("");
  });
});

describe("toLogisticsStateRows", () => {
  it("maps backend slots to labelled rows with dashes for unknowns", () => {
    const rows = toLogisticsStateRows({
      id: "st-1",
      conversation_id: "conv-1",
      pickup_location: "Chennai",
      destination: null,
      cargo_weight: 500,
      budget: null,
      created_at: "",
      updated_at: "",
    });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Pickup"]).toBe("Chennai");
    expect(byLabel["Destination"]).toBe("—");
    expect(byLabel["Weight"]).toBe("500 kg");
    expect(byLabel["Budget"]).toBe("—");
    expect(rows).toHaveLength(12);
  });

  it("returns no rows when there is no state yet", () => {
    expect(toLogisticsStateRows(null)).toEqual([]);
    expect(toLogisticsStateRows(undefined)).toEqual([]);
  });
});
