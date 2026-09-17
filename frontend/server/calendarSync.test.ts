import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMinuteLocal, stripSecondsToMinute } from "@/api/calendarDateTime";
import { calendarConnectionView } from "@/components/app/calendarConnection";
import {
  ApiError,
  CALENDAR_BOOKING_NOT_CONFIGURED_MESSAGE,
  getCalendarBookingErrorMessage,
} from "@/api/errors";

const BASE = "http://backend.test";

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

describe("calendar minute-precision helpers", () => {
  it("strips seconds from datetime-local values at the UI boundary", () => {
    expect(stripSecondsToMinute("2026-09-20T10:00:30")).toBe("2026-09-20T10:00");
    expect(stripSecondsToMinute("2026-09-20T10:00")).toBe("2026-09-20T10:00");
    expect(stripSecondsToMinute("")).toBe("");
    expect(stripSecondsToMinute("not-a-date")).toBe("not-a-date");
  });

  it("formats datetimes as YYYY-MM-DD HH:mm with no seconds", () => {
    const out = formatMinuteLocal("2026-09-20T10:00:00.000Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // Exactly one colon (HH:mm), never seconds.
    expect(out.split(":")).toHaveLength(2);
    expect(formatMinuteLocal(null)).toBe("—");
    expect(formatMinuteLocal("garbage")).toBe("garbage");
  });
});

describe("calendar booking unconfigured messaging (distinct from sync errors)", () => {
  const EXPECTED =
    "Calendar booking is not configured. Connect Google Calendar to create a meeting.";

  it("exposes the exact required message constant", () => {
    expect(CALENDAR_BOOKING_NOT_CONFIGURED_MESSAGE).toBe(EXPECTED);
  });

  it("maps the backend 503 booking signal to the exact message", () => {
    const err = new ApiError("unavailable", "Calendar booking not completed (disabled)", 503);
    expect(getCalendarBookingErrorMessage(err)).toBe(EXPECTED);
  });

  it("keeps other failures on the generic safe mapping", () => {
    expect(getCalendarBookingErrorMessage(new ApiError("server", "x", 502))).toBe(
      "Something went wrong on the server. Please try again later."
    );
    expect(getCalendarBookingErrorMessage(new ApiError("bad-request", "m", 400))).toBe("m");
  });
});

describe("calendar connection honesty (chip/kicker/metrics per state)", () => {
  it("keeps non-calendar integrations untouched (Operational)", () => {
    expect(calendarConnectionView(false, false, "failed")).toEqual({
      kicker: "CONNECTED SERVICE",
      chip: "operational",
      chipLabel: "Operational",
      metricsUnavailable: false,
    });
  });

  it("shows Operational only on persisted success", () => {
    expect(calendarConnectionView(true, false, "success")).toMatchObject({
      kicker: "CONNECTED SERVICE",
      chip: "operational",
      metricsUnavailable: true,
    });
  });

  it("shows Attention required on persisted failure (never Operational)", () => {
    const view = calendarConnectionView(true, false, "failed");
    expect(view.chip).toBe("attention");
    expect(view.chipLabel).toBe("Attention required");
    expect(view.kicker).toBe("SERVICE STATUS");
  });

  it("shows Not configured when never synced or disabled", () => {
    const view = calendarConnectionView(true, false, undefined);
    expect(view.chip).toBe("not-configured");
    expect(view.chipLabel).toBe("Not configured");
  });

  it("shows Checking… while the persisted status loads", () => {
    expect(calendarConnectionView(true, true, undefined).chip).toBe("checking");
    expect(calendarConnectionView(true, true, "failed").chip).toBe("checking");
  });
});

describe("calendar sync service mapping", () => {
  let captured: { url: string; init: { method?: string } } | null = null;
  const realFetch = (globalThis as any).fetch;

  beforeEach(async () => {
    captured = null;
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", BASE);
    (globalThis as any).fetch = vi.fn(async (url: string, init: { method?: string }) => {
      captured = { url, init };
      if (String(url).endsWith("/sync-status")) {
        return jsonResponse(200, { success: true, data: null });
      }
      return jsonResponse(200, {
        success: true,
        data: { id: 1, status: "success", last_sync_at: "2026-09-12T10:00:00.000Z", message: "ok" },
      });
    });
  });

  afterEach(() => {
    (globalThis as any).fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it("reads persisted status from GET /api/v1/calendar/sync-status", async () => {
    const { getCalendarSyncStatus } = await import("@/api/services/calendar");
    const state = await getCalendarSyncStatus();
    expect(captured!.url).toBe(`${BASE}/api/v1/calendar/sync-status`);
    expect(state).toBeNull();
  });

  it("runs sync via POST /api/v1/calendar/sync and unwraps the persisted row", async () => {
    const { runCalendarSync } = await import("@/api/services/calendar");
    const state = await runCalendarSync();
    expect(captured!.url).toBe(`${BASE}/api/v1/calendar/sync`);
    expect(captured!.init.method).toBe("POST");
    expect(state).toMatchObject({ status: "success" });
  });

  it("fetches structured diagnostics from GET /api/v1/calendar/diagnostics", async () => {
    const { getCalendarDiagnostics } = await import("@/api/services/calendar");
    (globalThis as any).fetch = vi.fn(async (url: string, init: { method?: string }) => {
      captured = { url, init };
      return jsonResponse(200, {
        success: true,
        data: {
          status: "not_configured",
          checks: [
            { name: "enabled", status: "failed", message: "disabled" },
            { name: "provider", status: "failed", message: "missing" },
            { name: "database", status: "ok", message: "reachable" },
            { name: "connectivity", status: "skipped", message: "not attempted" },
          ],
        },
      });
    });
    const diagnostics = await getCalendarDiagnostics();
    expect(captured!.url).toBe(`${BASE}/api/v1/calendar/diagnostics`);
    expect(diagnostics.status).toBe("not_configured");
    expect(diagnostics.checks).toHaveLength(4);
    expect(diagnostics.checks.map((c) => c.name)).toEqual(["enabled", "provider", "database", "connectivity"]);
  });
});
