/**
 * Phase 10 — Qualification service tests (list + by-id read endpoints).
 *
 * Mocks the network boundary only: asserts paths, pagination params,
 * envelope unwrapping, and 404 handling. No scoring logic here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/errors";
import { frontendEnv } from "@/api/env";
import { getQualificationById, listQualifications } from "@/api/services/qualifications";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("qualifications read service", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:3000";
  });

  it("lists qualifications newest-first with pagination", async () => {
    const spy = vi.fn(async () =>
      jsonResponse(200, {
        success: true,
        data: { qualifications: [{ id: "q-1" }], total: 1, page: 1, limit: 20 },
      })
    );
    vi.stubGlobal("fetch", spy);
    const result = await listQualifications(1, 20);
    expect(result.total).toBe(1);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("/api/v1/qualifications?");
    expect(url).toContain("page=1");
    expect(url).toContain("limit=20");
  });

  it("fetches a single qualification by id, including conversation rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          success: true,
          data: { id: "q-conv-9", call_id: null, conversation_id: "conv-9", tier: "HOT" },
        })
      )
    );
    const qual = await getQualificationById("q-conv-9");
    expect(qual).toMatchObject({ id: "q-conv-9", call_id: null, conversation_id: "conv-9" });
  });

  it("surfaces 404 for unknown ids without internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(404, { success: false, error: { message: "Qualification not found", code: 404 } })
      )
    );
    const error = await getQualificationById("q-missing").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("not-found");
  });
});
