// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionQuery, sessionKeys } from "@/api/hooks/useSession";
import { logout } from "@/api/session";
import { RequireAdmin } from "@/app/guards";
import { AppLayout } from "@/layouts/AppLayout";

const { redirects } = vi.hoisted(() => ({ redirects: [] as string[] }));

vi.mock("@/api/hooks/useCustomer", () => ({ useCustomerSessionProbe: () => ({ data: null, isPending: false }) }));
vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
  Redirect: ({ to }: { to: string }) => { redirects.push(to); return null; },
}));

function SessionProbe() {
  useSessionQuery();
  return <RequireAdmin><AppLayout path="/settings"><div>protected settings content</div></AppLayout></RequireAdmin>;
}

describe("session invalidation", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("clears protected cached data and role navigation after logout", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionKeys.current(), { id: "admin-1", email: "admin@example.com", role: "ADMIN" });
    queryClient.setQueryData(["leads", "list"], [{ id: "private-lead" }]);
    render(<QueryClientProvider client={queryClient}><SessionProbe /></QueryClientProvider>);
    expect(screen.getByText("protected settings content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await act(async () => { await logout(); });

    await waitFor(() => expect(redirects).toContain("/login"));
    expect(screen.queryByText("protected settings content")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    expect(queryClient.getQueryData(["leads", "list"])).toBeUndefined();
    expect(queryClient.getQueryData(sessionKeys.current())).toBeNull();
  });

  it("removes ADMIN UI and cached data when the backend session role changes", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionKeys.current(), { id: "admin-1", email: "admin@example.com", role: "ADMIN" });
    queryClient.setQueryData(["settings", "workspace"], { workspace_name: "private" });
    render(<QueryClientProvider client={queryClient}><SessionProbe /></QueryClientProvider>);
    expect(screen.getByText("protected settings content")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("madlead:session-updated", {
        detail: { id: "admin-1", email: "admin@example.com", role: "USER" },
      }));
    });

    expect(await screen.findByText("Not authorized")).toBeInTheDocument();
    expect(screen.queryByText("protected settings content")).not.toBeInTheDocument();
    expect(queryClient.getQueryData(["settings", "workspace"])).toBeUndefined();
  });
});
