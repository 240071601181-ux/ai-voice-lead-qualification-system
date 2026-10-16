// @vitest-environment jsdom
/**
 * Phase 20 — route-guard separation (real guard + real hooks, network
 * mocked at fetch only).
 *
 * - Internal session → admin routes render.
 * - No session + live customer session → bounce to /chat (never /login).
 * - No session at all → bounce to /login.
 * - A customer session alone never satisfies RequireAuth children.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth, RequireAdmin } from "@/app/guards";
import { frontendEnv } from "@/api/env";

let sessionUser: unknown = null;
let sessionPending = false;
let customerAlive = false;
const redirected: string[] = [];

vi.mock("@/api/hooks/useSession", () => ({
  useSessionQuery: () => ({
    data: sessionUser,
    isPending: sessionPending,
  }),
}));

vi.mock("wouter", () => ({
  Redirect: ({ to }: { to: string }) => {
    redirected.push(to);
    return null;
  },
}));

const JSON_HEADERS = { "content-type": "application/json" };

describe("RequireAuth admin/customer separation", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    sessionUser = null;
    sessionPending = false;
    customerAlive = false;
    redirected.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const target = String(url);
        if (target.endsWith("/api/v1/customer/conversation")) {
          if (customerAlive) {
            return new Response(
              JSON.stringify({ success: true, data: { id: "conv-1", status: "active", channel: "web" } }),
              { status: 200, headers: JSON_HEADERS }
            );
          }
          return new Response(
            JSON.stringify({ success: false, error: { message: "denied", code: 401 } }),
            { status: 401, headers: JSON_HEADERS }
          );
        }
        return new Response(
          JSON.stringify({ success: false, error: { message: "unexpected", code: 404 } }),
          { status: 404, headers: JSON_HEADERS }
        );
      })
    );
  });

  afterEach(() => {
    cleanup();
  });

  function renderGuard() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RequireAuth>
          <p>admin content</p>
        </RequireAuth>
      </QueryClientProvider>
    );
  }

  it("renders admin routes for an internal session", async () => {
    sessionUser = { id: "u-1", email: "admin@example.com", role: "ADMIN" };
    renderGuard();
    await waitFor(() => expect(screen.getByText("admin content")).toBeInTheDocument());
    expect(redirected).toEqual([]);
  });

  it("sends customer sessions to /chat instead of /login", async () => {
    sessionUser = null;
    sessionPending = false;
    customerAlive = true;
    renderGuard();
    await waitFor(() => expect(redirected).toContain("/chat"));
    expect(redirected).not.toContain("/login");
    expect(screen.queryByText("admin content")).not.toBeInTheDocument();
  });

  it("sends anonymous visitors to /login", async () => {
    sessionUser = null;
    customerAlive = false;
    renderGuard();
    await waitFor(() => expect(redirected).toContain("/login"));
    expect(redirected).not.toContain("/chat");
    expect(screen.queryByText("admin content")).not.toBeInTheDocument();
  });

  function renderAdminGuard() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RequireAdmin>
          <p>admin-only content</p>
        </RequireAdmin>
      </QueryClientProvider>
    );
  }

  it("renders ADMIN-only routes for ADMIN sessions", async () => {
    sessionUser = { id: "u-1", email: "admin@example.com", role: "ADMIN" };
    renderAdminGuard();
    await waitFor(() => expect(screen.getByText("admin-only content")).toBeInTheDocument());
  });

  it("shows the unauthorized page (never admin content) for USER sessions", async () => {
    sessionUser = { id: "u-2", email: "user@example.com", role: "USER" };
    renderAdminGuard();
    await waitFor(() => expect(screen.getByText("Not authorized")).toBeInTheDocument());
    expect(screen.queryByText("admin-only content")).not.toBeInTheDocument();
    expect(redirected).toEqual([]);
  });

  it("sends logged-out visitors on ADMIN routes to /login", async () => {
    sessionUser = null;
    customerAlive = false;
    renderAdminGuard();
    await waitFor(() => expect(redirected).toContain("/login"));
    expect(screen.queryByText("admin-only content")).not.toBeInTheDocument();
  });

  it("does not render protected content while the session is loading", () => {
    sessionPending = true;
    renderGuard();
    expect(screen.getByText("Checking your session…")).toBeInTheDocument();
    expect(screen.queryByText("admin content")).not.toBeInTheDocument();
    expect(redirected).toEqual([]);
  });

  it("fails closed when a session has no canonical backend role", async () => {
    sessionUser = { id: "u-3", email: "stale@example.com" };
    renderGuard();
    await waitFor(() => expect(screen.getByText(/Unable to verify your account role/)).toBeInTheDocument());
    expect(screen.queryByText("admin content")).not.toBeInTheDocument();
    expect(redirected).toEqual([]);
  });
});
