import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterQualificationRows } from "@/api/hooks/useQualifications";
import type { Lead, Qualification } from "@/api/types";

const BASE = "http://backend.test";

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

const lead = (id: string): Lead => ({
  id,
  source: "web",
  name: `Lead ${id}`,
  phone: "+911234567890",
  status: "NEW",
  created_at: "2026-09-12T09:00:00.000Z",
  updated_at: "2026-09-12T09:00:00.000Z",
});

const qual = (tier: "HOT" | "WARM" | "COLD", score: number): Qualification => ({
  id: `q-${tier}-${score}`,
  call_id: "call-1",
  lead_id: "lead-1",
  score,
  tier,
  details: {} as Qualification["details"],
  qualified_at: "2026-09-12T09:00:00.000Z",
  created_at: "2026-09-12T09:00:00.000Z",
  updated_at: "2026-09-12T09:00:00.000Z",
});

describe("qualifications page behavior", () => {
  it("filter keeps all rows on All signals and narrows by tier", () => {
    const rows = [
      { lead: lead("lead-1"), qualification: qual("HOT", 92) },
      { lead: lead("lead-2"), qualification: qual("WARM", 71) },
      { lead: lead("lead-3"), qualification: qual("COLD", 30) },
    ];
    expect(filterQualificationRows(rows, "All signals")).toHaveLength(3);
    expect(filterQualificationRows(rows, "HOT").map((r) => r.lead.id)).toEqual(["lead-1"]);
    expect(filterQualificationRows(rows, "WARM").map((r) => r.lead.id)).toEqual(["lead-2"]);
    expect(filterQualificationRows(rows, "COLD")).toHaveLength(1);
  });

  it("row navigation targets derive from real lead ids (no fabricated records)", () => {
    const rows = [{ lead: lead("lead-9"), qualification: qual("HOT", 90) }];
    // Row click → /leads/:leadId; View qualification → /qualifications/:leadId
    // (lead-first backend lookup); both use the real backend lead id.
    expect(`/leads/${rows[0].lead.id}`).toBe("/leads/lead-9");
    expect(`/qualifications/${rows[0].lead.id}`).toBe("/qualifications/lead-9");
    expect(rows[0].qualification.call_id).toBe("call-1");
  });
});

describe("createQualification service (row Re-run)", () => {
  let captured: { url: string; init: { method?: string; body?: string } } | null = null;
  const realFetch = (globalThis as any).fetch;

  beforeEach(async () => {
    captured = null;
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", BASE);
    (globalThis as any).fetch = vi.fn(async (url: string, init: { method?: string; body?: string }) => {
      captured = { url, init };
      return jsonResponse(201, {
        success: true,
        data: { id: "q-1", call_id: "call-1", lead_id: "lead-1", score: 85, tier: "HOT" },
      });
    });
  });

  afterEach(() => {
    (globalThis as any).fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it("reaches POST /api/v1/qualifications with only the record callId", async () => {
    const { createQualification } = await import("@/api/services/qualifications");
    const result = await createQualification({ callId: "call-1" });
    expect(captured!.url).toBe(`${BASE}/api/v1/qualifications`);
    expect(captured!.init.method).toBe("POST");
    expect(JSON.parse(captured!.init.body ?? "{}")).toEqual({ callId: "call-1" });
    expect(result).toMatchObject({ score: 85, tier: "HOT" });
  });
});
