/**
 * Phase 17 — user display-helper tests (pure, no DOM).
 *
 * Covers the avatar-initials rule (first two letters, uppercased),
 * edge cases, and the truthful Unnamed User fallback.
 */
import { describe, expect, it } from "vitest";
import {
  displayUserName,
  UNNAMED_USER_COPY,
  userInitials,
} from "@/components/app/userDisplay";

describe("userInitials", () => {
  it("uses the first two letters, uppercased", () => {
    expect(userInitials("Santhosh")).toBe("SA");
    expect(userInitials("Arun")).toBe("AR");
    expect(userInitials("Maya")).toBe("MA");
  });

  it("ignores leading whitespace", () => {
    expect(userInitials("  Santhosh")).toBe("SA");
  });

  it("handles one-character names", () => {
    expect(userInitials("A")).toBe("A");
  });

  it("falls back to U only when no name exists", () => {
    expect(userInitials("")).toBe("U");
    expect(userInitials("   ")).toBe("U");
    expect(userInitials(null)).toBe("U");
    expect(userInitials(undefined)).toBe("U");
  });

  it("never returns hardcoded initials", () => {
    expect(userInitials("Santhosh")).not.toBe("MS");
  });
});

describe("displayUserName", () => {
  it("returns the trimmed name", () => {
    expect(displayUserName("Santhosh")).toBe("Santhosh");
  });

  it("falls back to Unnamed User without inventing names", () => {
    expect(displayUserName(null)).toBe(UNNAMED_USER_COPY);
    expect(displayUserName("  ")).toBe(UNNAMED_USER_COPY);
    expect(displayUserName(undefined)).toBe(UNNAMED_USER_COPY);
  });
});
