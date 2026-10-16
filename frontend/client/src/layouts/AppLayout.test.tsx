// @vitest-environment jsdom
/**
 * Phase 21 — role-aware shell (real AppLayout, session mocked at the hook).
 *
 * - ADMIN sees the full sidebar; USER sees only the operational surface
 *   (backend remains the real boundary).
 * - The dashboard eyebrow greets by time-of-day + the session's first name
 *   (never a hardcoded name); other pages keep their static eyebrow.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppLayout, dashboardEyebrow, isNavPathActive, visibleNavGroups } from "@/layouts/AppLayout";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard", navigate],
}));

vi.mock("@/api/hooks/useSession", () => ({
  useSessionQuery: () => ({
    data: (globalThis as unknown as { __sessionUser?: unknown }).__sessionUser ?? null,
    isPending: false,
  }),
}));

function renderShell(path = "/dashboard") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AppLayout path={path}>
        <p>page body</p>
      </AppLayout>
    </QueryClientProvider>
  );
}

describe("dashboardEyebrow", () => {
  it("greets by time of day with the session first name", () => {
    expect(dashboardEyebrow("Santhosh Punnaivanam", new Date(2026, 0, 1, 9, 0))).toBe(
      "GOOD MORNING, SANTHOSH"
    );
    expect(dashboardEyebrow("Santhosh", new Date(2026, 0, 1, 14, 0))).toBe("GOOD AFTERNOON, SANTHOSH");
    expect(dashboardEyebrow("Santhosh", new Date(2026, 0, 1, 20, 0))).toBe("GOOD EVENING, SANTHOSH");
  });

  it("falls back neutrally without inventing a name", () => {
    expect(dashboardEyebrow(null, new Date(2026, 0, 1, 9, 0))).toBe("GOOD MORNING");
    expect(dashboardEyebrow("   ", new Date(2026, 0, 1, 9, 0))).toBe("GOOD MORNING");
    expect(dashboardEyebrow("Santhosh", new Date(2026, 0, 1, 9, 0))).not.toContain("MAYA");
  });
});

describe("visibleNavGroups", () => {
  it("shows everything to ADMIN", () => {
    const labels = visibleNavGroups("ADMIN").flatMap((g) => g.items.map((i) => i.path));
    for (const path of ["/dashboard", "/settings", "/ai-agent", "/knowledge", "/crm", "/profile"]) {
      expect(labels).toContain(path);
    }
  });

  it("shows shared work areas to USER and omits only administrator destinations", () => {
    const labels = visibleNavGroups("USER").flatMap((g) => g.items.map((i) => i.path));
    for (const path of ["/dashboard", "/leads", "/conversations", "/qualifications", "/followups", "/calendar", "/crm", "/whatsapp", "/knowledge", "/automation", "/activity", "/notifications", "/profile", "/help"]) {
      expect(labels).toContain(path);
    }
    for (const path of ["/ai-agent", "/knowledge/ingest", "/settings"]) {
      expect(labels).not.toContain(path);
    }
  });

  it("shows no role-dependent navigation until a canonical role is resolved", () => {
    expect(visibleNavGroups(undefined)).toEqual([]);
    expect(visibleNavGroups("OPERATOR")).toEqual([]);
  });

  it("marks the correct section active on nested routes", () => {
    expect(isNavPathActive("/qualifications/q-1", "/qualifications")).toBe(true);
    expect(isNavPathActive("/leads-extra", "/leads")).toBe(false);
  });
});

describe("AppLayout shell", () => {
  afterEach(() => {
    cleanup();
    navigate.mockClear();
  });

  it("renders the admin sidebar and a personal eyebrow for ADMIN", () => {
    (globalThis as unknown as { __sessionUser?: unknown }).__sessionUser = {
      id: "u-1",
      email: "admin@example.com",
      name: "Santhosh",
      role: "ADMIN",
    };
    renderShell();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("AI Agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open notifications" })).toBeInTheDocument();
    expect(screen.getByText(/GOOD (MORNING|AFTERNOON|EVENING), SANTHOSH/)).toBeInTheDocument();
    expect(screen.queryByText(/MAYA/)).not.toBeInTheDocument();
  });

  it("hides admin-only entries for USER", () => {
    (globalThis as unknown as { __sessionUser?: unknown }).__sessionUser = {
      id: "u-2",
      email: "user@example.com",
      name: "Staff User",
      role: "USER",
    };
    renderShell();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Knowledge Base")).not.toBeInTheDocument();
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("Conversations")).toBeInTheDocument();
    expect(screen.getByText("Knowledge Base")).toBeInTheDocument();
    expect(screen.getByText("Automation / n8n")).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open notifications" })).toBeInTheDocument();
  });

  it("keeps topbar notifications and profile links on valid shared routes", async () => {
    const user = userEvent.setup();
    (globalThis as unknown as { __sessionUser?: unknown }).__sessionUser = {
      id: "u-2", email: "user@example.com", name: "Staff User", role: "USER",
    };
    renderShell();
    await user.click(screen.getByRole("button", { name: "Open notifications" }));
    expect(navigate).toHaveBeenCalledWith("/notifications");
    fireEvent.click(screen.getByRole("button", { name: "Open profile for Staff User" }));
    expect(navigate).toHaveBeenCalledWith("/profile");
  });
});
