// @vitest-environment jsdom
/**
 * Phase 17 — Leads EMAIL-column tests (real page + real hooks, network
 * boundary mocked at fetch only).
 *
 * Verifies the Company column is gone, the EMAIL column shows ONLY the
 * lead email (or "—"), with graceful truncation metadata. No company,
 * source, phone, or UUID in the email cells.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LeadsPageRoute from "@/pages/leads/LeadsPage";
import { frontendEnv } from "@/api/env";

vi.mock("wouter", () => ({
  useLocation: () => ["/leads", vi.fn()],
  useParams: () => ({}),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const leads = [
  {
    id: "lead-1", source: "web", name: "Divya Menon", phone: "+919876543212",
    email: "divya.menon.very.long.address@example.com", status: "NEW",
    created_at: "2026-09-19T00:00:00.000Z", updated_at: "2026-09-19T00:00:00.000Z",
  },
  {
    id: "lead-2", source: "web", name: "No Email", phone: "+911234567890",
    email: null, status: "NEW",
    created_at: "2026-09-19T00:00:00.000Z", updated_at: "2026-09-19T00:00:00.000Z",
  },
];

describe("LeadsPage EMAIL column", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).includes("/api/v1/leads")) {
          return jsonResponse(200, { success: true, data: { leads, total: 2, page: 1, limit: 20 } });
        }
        return jsonResponse(500, { success: false, error: { message: "unexpected" } });
      })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("shows an EMAIL header with only emails (or —) in the cells", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LeadsPageRoute />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText("Divya Menon")).toBeInTheDocument());

    const table = screen.getByRole("table");
    expect(within(table).getByText("Email")).toBeInTheDocument();
    expect(within(table).queryByText("Company")).not.toBeInTheDocument();

    const emailCell = screen.getByText("divya.menon.very.long.address@example.com");
    expect(emailCell).toBeInTheDocument();
    expect(emailCell).toHaveAttribute("title", "divya.menon.very.long.address@example.com");
    // No company/source/phone/UUID leakage inside the email cells.
    const row = emailCell.closest("tr")!;
    expect(within(row).queryByText(/Source:/)).not.toBeInTheDocument();
    expect(within(row).queryByText("+919876543212")).not.toBeInTheDocument();

    expect(screen.getByText("No Email")).toBeInTheDocument();
    const unnamedRow = screen.getByText("No Email").closest("tr")!;
    const unnamedEmailCell = within(unnamedRow).getByTitle("No email");
    expect(unnamedEmailCell).toHaveTextContent("—");
  });
});
