// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "@/app/routes";

// Markdown rendering (streamdown → katex CSS chain) cannot be transformed
// by the node test runner and is irrelevant to route-policy assertions:
// these tests verify guards, redirects, and 404s, never chat typography.
// (Same stub convention as AIChatBox.test.tsx and the conversation tests.)
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <>{children}</>,
}));

let sessionUser: unknown = null;
let sessionPending = false;

vi.mock("@/api/hooks/useSession", () => ({
  useSessionQuery: () => ({ data: sessionUser, isPending: sessionPending }),
}));
vi.mock("@/api/hooks/useCustomer", () => ({
  useCustomerSessionProbe: () => ({ data: null, isPending: false }),
}));
vi.mock("@/pages/system/SettingsPage", () => ({ default: () => <p>settings route content</p> }));
vi.mock("@/pages/ai-agent/AiAgentPage", () => ({ default: () => <p>AI agent route content</p> }));
vi.mock("@/pages/leads/LeadsPage", () => ({ default: () => <p>shared leads content</p> }));
vi.mock("@/pages/chat/CustomerChatPage", () => ({ default: () => <p>public customer chat content</p> }));

function renderRouter(path: string) {
  window.history.replaceState({}, "", path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Router /></QueryClientProvider>);
}

describe("application route role policy", () => {
  beforeEach(() => {
    sessionUser = null;
    sessionPending = false;
  });
  afterEach(() => cleanup());

  it("renders protected admin destinations for ADMIN and blocks USER direct URLs", async () => {
    sessionUser = { id: "a-1", email: "admin@example.com", role: "ADMIN" };
    const admin = renderRouter("/settings");
    expect(await screen.findByText("settings route content")).toBeInTheDocument();
    admin.unmount();

    sessionUser = { id: "a-1", email: "admin@example.com", role: "ADMIN" };
    const adminAgent = renderRouter("/ai-agent");
    expect(await screen.findByText("AI agent route content")).toBeInTheDocument();
    adminAgent.unmount();

    sessionUser = { id: "u-1", email: "user@example.com", role: "USER" };
    renderRouter("/settings");
    expect(await screen.findByText("Not authorized")).toBeInTheDocument();
    expect(screen.queryByText("settings route content")).not.toBeInTheDocument();
  });

  it("keeps shared and public customer routes available and renders intentional 404", async () => {
    sessionUser = { id: "u-1", email: "user@example.com", role: "USER" };
    const shared = renderRouter("/leads");
    expect(await screen.findByText("shared leads content")).toBeInTheDocument();
    shared.unmount();

    sessionUser = null;
    const customer = renderRouter("/chat/demo-token");
    expect(await screen.findByText("public customer chat content")).toBeInTheDocument();
    customer.unmount();

    renderRouter("/not-a-real-page");
    expect(await screen.findByText("Page Not Found")).toBeInTheDocument();
  });

  it("does not render protected pages before session resolution", async () => {
    sessionPending = true;
    renderRouter("/ai-agent");
    expect(screen.getByText("Checking your session…")).toBeInTheDocument();
    expect(screen.queryByText("AI agent route content")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("AI agent route content")).not.toBeInTheDocument());
  });
});
