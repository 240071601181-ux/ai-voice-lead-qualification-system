// @vitest-environment jsdom
/**
 * Phase 12 — MeetingPanel interaction tests (real component + real hooks,
 * network boundary mocked at fetch only).
 *
 * Verifies URL/method/body/query/auth for the availability + booking
 * endpoints, loading states, truthful errors, stale-slot invalidation,
 * and the disabled-reason copy. No mocks of business logic.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingPanel, validateMeetingSlot } from "@/components/app/MeetingPanel";
import { frontendEnv } from "@/api/env";

vi.mock("@/api/session", () => ({
  authedRequest: <T,>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> =>
    fn({ Authorization: "Bearer test-token" }),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(responder: Responder) {
  const spy = vi.fn(async (url: unknown, init?: RequestInit) => responder(String(url), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderPanel(props: { schedulable?: boolean; schedulableReason?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MeetingPanel conversationId="conv-1" {...props} />
    </QueryClientProvider>
  );
}

/** datetime-local value N days in the future at 10:00/11:00 local. */
function futureSlot(daysAhead = 7): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const at = (days: number, hour: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setHours(hour, 0, 0, 0);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return { start: at(daysAhead, 10), end: at(daysAhead, 11) };
}

async function fillSlot(user: ReturnType<typeof userEvent.setup>, start: string, end: string) {
  await user.clear(screen.getByLabelText("Start"));
  await user.type(screen.getByLabelText("Start"), start);
  await user.clear(screen.getByLabelText("End"));
  await user.type(screen.getByLabelText("End"), end);
}

describe("validateMeetingSlot", () => {
  it("requires both times", () => {
    expect(validateMeetingSlot("", "")).toMatch(/start and an end/i);
  });

  it("rejects end before start", () => {
    const { start, end } = futureSlot();
    expect(validateMeetingSlot(end, start)).toMatch(/after the start/i);
  });

  it("rejects past times", () => {
    expect(validateMeetingSlot("2020-01-01T10:00", "2020-01-01T11:00")).toMatch(/future/i);
  });

  it("accepts a valid future slot", () => {
    const { start, end } = futureSlot();
    expect(validateMeetingSlot(start, end)).toBeNull();
  });
});

describe("MeetingPanel", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    frontendEnv.apiBaseUrl = "http://localhost:4000";
  });

  afterEach(() => {
    cleanup();
  });

  it("uses datetime-local inputs and keeps actions disabled until a valid slot", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByLabelText("Start")).toHaveAttribute("type", "datetime-local");
    expect(screen.getByLabelText("End")).toHaveAttribute("type", "datetime-local");
    expect(screen.getByRole("button", { name: /check availability/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /book meeting/i })).toBeDisabled();

    const { start, end } = futureSlot();
    await fillSlot(user, start, end);
    expect(screen.getByRole("button", { name: /check availability/i })).toBeEnabled();
    // Booking still needs a confirmed slot first.
    expect(screen.getByTestId("meeting-book-hint")).toHaveTextContent(/check availability first/i);
  });

  it("checks availability with the correct URL/method/query/auth, then books", async () => {
    const user = userEvent.setup();
    const spy = mockFetch((url, init) => {
      if (url.includes("/calendar/availability")) {
        return jsonResponse(200, { success: true, data: { available: true } });
      }
      if (url.includes("/calendar/book")) {
        return jsonResponse(201, {
          success: true,
          data: {
            id: "book-1", booking_key: "k", lead_id: "lead-1", call_id: null,
            conversation_id: "conv-1", qualification_id: null, provider: "google",
            calendar_id: "primary", external_event_id: "evt-1", meet_url: "https://meet.google.com/abc",
            scheduled_start: "2030-01-01T10:00:00.000Z", scheduled_end: "2030-01-01T11:00:00.000Z",
            timezone: "Asia/Kolkata", status: "booked", attempts: 1, slot_hash: "h",
            last_error: null, created_at: "", updated_at: "",
          },
        });
      }
      return jsonResponse(500, { success: false, error: { message: "unexpected" } });
    });
    renderPanel();
    const { start, end } = futureSlot();
    await fillSlot(user, start, end);
    await user.click(screen.getByRole("button", { name: /check availability/i }));

    await waitFor(() =>
      expect(screen.getByTestId("meeting-availability-result")).toHaveTextContent(/available/i)
    );
    const availCall = spy.mock.calls.find(([u]) => String(u).includes("/calendar/availability"))!;
    expect(availCall[1]?.method).toBe("GET");
    expect(availCall[1]?.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(String(availCall[0])).toContain(encodeURIComponent(start));
    expect(String(availCall[0])).toContain("timezone=Asia%2FKolkata");

    await user.click(screen.getByRole("button", { name: /book meeting/i }));
    await waitFor(() => expect(screen.getByTestId("meeting-booking-result")).toBeInTheDocument());
    const bookCall = spy.mock.calls.find(([u]) => String(u).includes("/calendar/book"))!;
    expect(bookCall[1]?.method).toBe("POST");
    expect(JSON.parse(String(bookCall[1]?.body))).toMatchObject({ start, end, timezone: "Asia/Kolkata" });
    expect(screen.getByRole("link", { name: /join meeting/i })).toHaveAttribute(
      "href",
      "https://meet.google.com/abc"
    );
  });

  it("keeps Book disabled with a reason when the slot is unavailable", async () => {
    const user = userEvent.setup();
    mockFetch((url) =>
      url.includes("/calendar/availability")
        ? jsonResponse(200, { success: true, data: { available: false } })
        : jsonResponse(500, { success: false, error: { message: "unexpected" } })
    );
    renderPanel();
    const { start, end } = futureSlot();
    await fillSlot(user, start, end);
    await user.click(screen.getByRole("button", { name: /check availability/i }));
    await waitFor(() =>
      expect(screen.getByTestId("meeting-availability-result")).toHaveTextContent(/not available/i)
    );
    expect(screen.getByRole("button", { name: /book meeting/i })).toBeDisabled();
    expect(screen.getByTestId("meeting-book-hint")).toHaveTextContent(/not available/i);
  });

  it("shows the truthful not-configured message on 503 with retry", async () => {
    const user = userEvent.setup({ delay: null });
    const spy = mockFetch((url) =>
      url.includes("/calendar/availability")
        ? jsonResponse(503, {
            success: false,
            error: { message: "Calendar booking is not configured. Connect Google Calendar to create a meeting.", code: 503 },
          })
        : jsonResponse(500, { success: false, error: { message: "unexpected" } })
    );
    renderPanel();
    const { start, end } = futureSlot();
    await fillSlot(user, start, end);
    await user.click(screen.getByRole("button", { name: /check availability/i }));
    await waitFor(() => expect(screen.getByText(/not configured/i)).toBeInTheDocument(), {
      timeout: 5000,
    });
    const before = spy.mock.calls.length;
    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before), { timeout: 5000 });
  });

  it("invalidates the previous check when the slot is edited (no stale booking)", async () => {
    const user = userEvent.setup();
    mockFetch((url) =>
      url.includes("/calendar/availability")
        ? jsonResponse(200, { success: true, data: { available: true } })
        : jsonResponse(500, { success: false, error: { message: "unexpected" } })
    );
    renderPanel();
    const { start, end } = futureSlot();
    await fillSlot(user, start, end);
    await user.click(screen.getByRole("button", { name: /check availability/i }));
    await waitFor(() =>
      expect(screen.getByTestId("meeting-availability-result")).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /book meeting/i })).toBeEnabled();

    // Editing the slot clears the old result: booking must be re-confirmed.
    // (The replacement start stays before the current end so the slot is valid.)
    const { start: start2 } = futureSlot(6);
    await user.clear(screen.getByLabelText("Start"));
    await user.type(screen.getByLabelText("Start"), start2);
    expect(screen.queryByTestId("meeting-availability-result")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /book meeting/i })).toBeDisabled();
    expect(screen.getByTestId("meeting-book-hint")).toHaveTextContent(/check availability first/i);
  });

  it("disables everything with a reason when the conversation cannot schedule", () => {
    renderPanel({ schedulable: false, schedulableReason: "Abandoned conversations cannot schedule." });
    expect(screen.getByTestId("meeting-disabled-reason")).toHaveTextContent(/abandoned/i);
    expect(screen.getByLabelText("Start")).toBeDisabled();
    expect(screen.getByRole("button", { name: /check availability/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /book meeting/i })).toBeDisabled();
  });
});
