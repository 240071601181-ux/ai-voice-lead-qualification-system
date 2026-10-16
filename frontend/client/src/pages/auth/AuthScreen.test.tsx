// @vitest-environment jsdom
/**
 * Login resolves role from the backend session (real component + hooks,
 * network boundary mocked at fetch only).
 *
 * There is no independent role selector: route and layout access follow the
 * backend-provided role for both ADMIN and USER sessions.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthScreen } from "@/pages/auth/AuthScreen";
import ResetPasswordPage from "@/pages/auth/ResetPasswordPage";
import VerifyEmailPage from "@/pages/auth/VerifyEmailPage";
import { frontendEnv } from "@/api/env";
import { resetSessionForTests } from "@/api/session";

const navigateMock = vi.fn();

// Auth visuals query matchMedia / IntersectionObserver, which jsdom does
// not implement.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
    writable: true,
  });
}
if (typeof window !== "undefined" && typeof window.IntersectionObserver !== "function") {
  Object.defineProperty(window, "IntersectionObserver", {
    value: vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })),
    writable: true,
  });
}

vi.mock("wouter", () => ({
  useLocation: () => ["/login", navigateMock],
}));

const JSON_HEADERS = { "content-type": "application/json" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function mockFetch() {
  const spy = vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    return jsonResponse(404, { success: false, error: { message: "unexpected", code: 404 } });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("AuthScreen session role", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
    navigateMock.mockClear();
    resetSessionForTests();
  });

  afterEach(() => {
    cleanup();
  });

  function renderLogin() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthScreen mode="/login" />
      </QueryClientProvider>
    );
  }

  async function signInAs(email: string) {
    const user = userEvent.setup();
    // Stable accessible-name queries matching the production labels
    // (the inputs carry no placeholders by design).
    await user.type(screen.getByLabelText("Work email"), email);
    await user.type(screen.getByLabelText("Password"), "password-123456");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
  }

  function mockLoginWithRole(role: "ADMIN" | "USER") {
    const spy = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && target.endsWith("/api/v1/auth/login")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse(200, {
          success: true,
          data: {
            user: { id: "u-1", email: body.email, name: "Test User", role },
            accessToken: "access-1",
            accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          },
        });
      }
      if (method === "POST" && target.endsWith("/api/v1/auth/logout")) {
        return jsonResponse(200, { success: true, data: { loggedOut: true } });
      }
      return jsonResponse(404, { success: false, error: { message: "unexpected", code: 404 } });
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("enters with a USER session and leaves permissions to the route policy", { timeout: 30000 }, async () => {
    mockLoginWithRole("USER");
    renderLogin();
    await signInAs("user@example.com");
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("enters with an ADMIN session", { timeout: 30000 }, async () => {
    mockLoginWithRole("ADMIN");
    renderLogin();
    await signInAs("admin@example.com");
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("offers no role selector on signup and notes User defaults", async () => {
    mockFetch();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthScreen mode="/signup" />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Public signups receive User access/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Continue as" })).not.toBeInTheDocument();
  });

  it("validates required registration fields before contacting the backend", async () => {
    const spy = mockFetch();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthScreen mode="/signup" /></QueryClientProvider>);
    await userEvent.setup().click(screen.getByRole("button", { name: /create account/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("valid email address");
    expect(spy).not.toHaveBeenCalled();
  });

  it("submits registration to the backend and enters with its USER session", async () => {
    const spy = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/api/v1/auth/register")) {
        return jsonResponse(201, {
          success: true,
          data: {
            user: { id: "u-new", email: "new@example.com", name: "New User", role: "USER" },
            accessToken: "access-1",
            accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          },
        });
      }
      return jsonResponse(404, { success: false, error: { message: "unexpected", code: 404 } });
    });
    vi.stubGlobal("fetch", spy);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthScreen mode="/signup" /></QueryClientProvider>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Full name"), "New User");
    await user.type(screen.getByLabelText("Work email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "password-123");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/dashboard"));
    const request = spy.mock.calls.find(([url]) => String(url).endsWith("/api/v1/auth/register"));
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ email: "new@example.com", password: "password-123", name: "New User" });
  });

  it("shows an explicit recovery limitation without sending a fake request", async () => {
    const spy = mockFetch();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthScreen mode="/forgot-password" /></QueryClientProvider>);
    expect(screen.getByText(/Password recovery email is not configured/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send reset/i })).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not render a fake remember-me control", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthScreen mode="/login" /></QueryClientProvider>);
    expect(screen.queryByLabelText(/remember me/i)).not.toBeInTheDocument();
    expect(screen.getByText(/HTTP-only cookie/)).toBeInTheDocument();
  });

  it("keeps old reset and verification URLs truthful and non-mutating", () => {
    const { rerender } = render(<ResetPasswordPage />);
    expect(screen.getByText(/cannot issue or validate password reset links/)).toBeInTheDocument();
    expect(screen.getByText(/No password has been changed/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    rerender(<VerifyEmailPage />);
    expect(screen.getByText(/Email verification is not required/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resend/i })).not.toBeInTheDocument();
  });

  it("shows the same backend credential error for an incorrect login", async () => {
    const spy = vi.fn(async () => jsonResponse(401, {
      success: false,
      error: { message: "Invalid email or password", code: 401 },
    }));
    vi.stubGlobal("fetch", spy);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthScreen mode="/login" /></QueryClientProvider>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Work email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("prevents repeated login submissions while the backend request is pending", async () => {
    let resolveResponse!: (response: Response) => void;
    const spy = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal("fetch", spy);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthScreen mode="/login" /></QueryClientProvider>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Work email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "password-123");
    const submit = screen.getByRole("button", { name: /sign in/i });
    await user.click(submit);
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(spy).toHaveBeenCalledTimes(1);
    resolveResponse(jsonResponse(200, {
      success: true,
      data: {
        user: { id: "u-1", email: "person@example.com", role: "USER" },
        accessToken: "access-1",
        accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      },
    }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/dashboard"));
  });
});
