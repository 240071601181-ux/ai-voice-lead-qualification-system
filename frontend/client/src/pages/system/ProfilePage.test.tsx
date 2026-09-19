// @vitest-environment jsdom
/**
 * Phase 17 — ProfilePage tests (real page + real hooks, network boundary
 * mocked at fetch only).
 *
 * Verifies the real authenticated user renders (name/email/initials, never
 * Maya Singh/MS/Acme), missing fields fall back truthfully, and saving the
 * display name fires PATCH /api/v1/auth/me with only the name.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "@/pages/system/ProfilePage";
import { frontendEnv } from "@/api/env";

vi.mock("wouter", () => ({
  useLocation: () => ["/profile", vi.fn()],
  useParams: () => ({}),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const santhosh = {
  id: "user-1",
  email: "santhosh@example.com",
  name: "Santhosh",
  status: "active",
};

function mockFetch(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  const spy = vi.fn(async (url: unknown, init?: RequestInit) => impl(String(url), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>
  );
}

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
  });

  afterEach(() => {
    cleanup();
  });

  function mockSession(user: unknown) {
    return mockFetch((url, init) => {
      if (String(init?.method || "GET") === "PATCH" && String(url).endsWith("/auth/me")) {
        return jsonResponse(200, { success: true, data: { ...(user as object), name: "Santhosh Kumar" } });
      }
      if (String(url).includes("/auth/refresh")) {
        return jsonResponse(200, {
          success: true,
          data: { user, accessToken: "access-1", accessExpiresAt: new Date().toISOString() },
        });
      }
      return jsonResponse(500, { success: false, error: { message: "unexpected" } });
    });
  }

  it("renders the real user with derived initials, never demo data", async () => {
    mockSession(santhosh);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("profile-name")).toHaveTextContent("Santhosh"));
    expect(screen.getByTestId("profile-email")).toHaveTextContent("santhosh@example.com");
    expect(screen.queryByText("Maya Singh")).not.toBeInTheDocument();
    expect(screen.queryByText("Acme Cargo")).not.toBeInTheDocument();
    expect(screen.queryByText("MS")).not.toBeInTheDocument();
    expect(screen.getByText("SA")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Role not set")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Workspace not set")).toBeInTheDocument();
  });

  it("falls back truthfully when the name is missing", async () => {
    mockSession({ ...santhosh, name: null });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("profile-name")).toHaveTextContent("Unnamed User"));
    expect(screen.getByText("U")).toBeInTheDocument();
  });

  it("saves the display name with only the name field", async () => {
    const user = userEvent.setup({ delay: null });
    const spy = mockSession(santhosh);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("profile-name")).toHaveTextContent("Santhosh"));

    const input = screen.getByLabelText("Full name");
    await user.clear(input);
    await user.type(input, "Santhosh Kumar");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([u, i]) => String(u).endsWith("/auth/me") && i?.method === "PATCH"
        )
      ).toBe(true)
    );
    const call = spy.mock.calls.find(([u, i]) => String(u).endsWith("/auth/me") && i?.method === "PATCH")!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ name: "Santhosh Kumar" });
    await waitFor(() => expect(screen.getByTestId("profile-name")).toHaveTextContent("Santhosh Kumar"));
  });
});
