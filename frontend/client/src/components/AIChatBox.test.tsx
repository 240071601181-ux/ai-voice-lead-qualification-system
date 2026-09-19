// @vitest-environment jsdom
/**
 * Phase 12 — AIChatBox interaction tests (pure presentational contract).
 *
 * Verifies the send-button enablement, submit flow, loading state, and
 * disabled-composer behavior. No network, no mocks of business logic.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIChatBox } from "@/components/AIChatBox";

// Markdown rendering (katex CSS chain) is irrelevant to this contract test.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <>{children}</>,
}));

const messages = [
  { role: "user" as const, content: "Hi, I need a truck.", timestamp: "10:00 AM" },
  { role: "assistant" as const, content: "Where from?", timestamp: "10:01 AM" },
];

describe("AIChatBox", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders user and assistant bubbles with timestamps", () => {
    render(<AIChatBox messages={messages} onSendMessage={() => {}} />);
    expect(screen.getByTestId("chat-bubble-user")).toHaveTextContent("Hi, I need a truck.");
    expect(screen.getByTestId("chat-bubble-assistant")).toHaveTextContent("Where from?");
    expect(screen.getByText("10:00 AM")).toBeInTheDocument();
  });

  it("keeps send disabled for empty input and sends trimmed text on submit", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<AIChatBox messages={[]} onSendMessage={onSend} />);
    const send = screen.getByRole("button", { name: /send/i });
    expect(send).toBeDisabled();
    const box = screen.getByRole("textbox");
    await user.type(box, "  hello  ");
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello");
    expect(box).toHaveValue("");
  });

  it("shows the typing indicator and blocks resend while loading", async () => {
    const user = userEvent.setup();
    render(<AIChatBox messages={messages} onSendMessage={() => {}} isLoading />);
    expect(screen.getByTestId("chat-loading")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "another");
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("renders the disabled message instead of the composer when disabled", () => {
    render(
      <AIChatBox
        messages={messages}
        onSendMessage={() => {}}
        disabled
        disabledMessage="Messaging is disabled."
        suggestedPrompts={["I need a truck"]}
      />
    );
    expect(screen.getByText("Messaging is disabled.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // Suggested prompts must not offer sends on a closed conversation.
    expect(screen.queryByRole("button", { name: /i need a truck/i })).not.toBeInTheDocument();
  });

  it("does not stretch the last message with a spacer", () => {
    render(<AIChatBox messages={messages} onSendMessage={() => {}} />);
    const bubble = screen.getByTestId("chat-bubble-assistant");
    expect(bubble.closest("[style*='min-height']")).toBeNull();
  });
});
