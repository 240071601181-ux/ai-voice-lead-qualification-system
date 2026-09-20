import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Loader2, Send, User, Sparkles } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Streamdown } from "streamdown";

/**
 * Message type for chat bubbles. System/tool rows must be filtered out by
 * the caller (see toVisibleMessages) — only user/assistant render here.
 */
export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
  /** Optional pre-formatted timestamp rendered under the bubble. */
  timestamp?: string;
  /** Persisted id — used as the React key so re-sorts never collide. */
  id?: string;
};

export type AIChatBoxProps = {
  /**
   * Messages array to display in the chat.
   * Callers pass backend records mapped to { role, content, timestamp? }.
   */
  messages: Message[];

  /**
   * Callback when user sends a message.
   * Typically a React Query mutation against the real conversation API.
   */
  onSendMessage: (content: string) => void;

  /**
   * Whether the AI is currently generating a response
   */
  isLoading?: boolean;

  /**
   * Disable the composer (e.g. completed conversations). History still renders.
   */
  disabled?: boolean;

  /**
   * Message shown in place of the input when disabled.
   */
  disabledMessage?: string;

  /**
   * Placeholder text for the input field
   */
  placeholder?: string;

  /**
   * Custom className for the container
   */
  className?: string;

  /**
   * Height of the chat box (default: 600px)
   */
  height?: string | number;

  /**
   * Empty state message to display when no messages
   */
  emptyStateMessage?: string;

  /**
   * Suggested prompts to display in empty state
   * Click to send directly
   */
  suggestedPrompts?: string[];
};

/**
 * A ready-to-use chat box component.
 *
 * Features:
 * - Markdown rendering with Streamdown (assistant bubbles)
 * - Auto-scrolls to latest message
 * - Loading states
 * - Optional per-message timestamps
 * - Enter sends / Shift+Enter newline, send disabled while loading
 * - Uses global theme colors from index.css
 *
 * Used by the text-conversation detail page against the real Express
 * conversation API (POST /api/v1/conversations/:id/messages). The page owns
 * persistence, retries, and error states — this component only renders
 * bubbles and collects input (no streaming, no fake messages).
 *
 * @example
 * ```tsx
 * const detail = useConversationMessagesQuery(id);
 * const send = useSendConversationMessageMutation(id);
 * const messages = toVisibleMessages(detail.data?.messages ?? []);
 * return (
 *   <AIChatBox
 *     messages={messages.map((m) => ({
 *       id: m.id,
 *       role: m.role,
 *       content: m.content,
 *       timestamp: formatMessageTime(m.created_at),
 *     }))}
 *     onSendMessage={(content) => send.mutate({ content })}
 *     isLoading={send.isPending}
 *   />
 * );
 * ```
 */
export function AIChatBox({
  messages,
  onSendMessage,
  isLoading = false,
  disabled = false,
  disabledMessage = "This conversation is no longer active.",
  placeholder = "Type your message...",
  className,
  height = "clamp(480px, 68vh, 720px)",
  emptyStateMessage = "Start a conversation with AI",
  suggestedPrompts,
}: AIChatBoxProps) {
  const [input, setInput] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Synchronous double-submit guard: the isLoading prop flips only after
  // the parent re-renders, so two Enters in the same tick would otherwise
  // both pass the check below. The ref flips synchronously instead.
  const submitInFlight = useRef(false);
  useEffect(() => {
    if (!isLoading) submitInFlight.current = false;
  }, [isLoading]);

  // Filter out system messages
  const displayMessages = messages.filter((msg) => msg.role !== "system");

  // Scroll to bottom helper function with smooth animation
  const scrollToBottom = () => {
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLDivElement | null;

    if (!viewport) return;
    requestAnimationFrame(() => {
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: 'smooth'
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
  };

  // Keep the latest message visible as history grows or the reply streams in.
  useEffect(() => {
    scrollToBottom();
  }, [displayMessages.length, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading || disabled || submitInFlight.current) return;
    submitInFlight.current = true;

    onSendMessage(trimmedInput);
    setInput("");

    // Scroll immediately after sending
    scrollToBottom();

    // Keep focus on input
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col bg-card text-card-foreground rounded-lg border shadow-sm min-w-0",
        className
      )}
      style={{ height }}
    >
      {/* Messages Area */}
      <div ref={scrollAreaRef} className="flex-1 overflow-hidden">
        {displayMessages.length === 0 ? (
          <div className="flex h-full flex-col p-4">
            <div className="flex flex-1 flex-col items-center justify-center gap-6 text-muted-foreground">
              <div className="flex flex-col items-center gap-3">
                <Sparkles className="size-12 opacity-20" />
                <p className="text-sm">{emptyStateMessage}</p>
              </div>

              {suggestedPrompts && suggestedPrompts.length > 0 && !disabled && (
                <div className="flex max-w-2xl flex-wrap justify-center gap-2">
                  {suggestedPrompts.map((prompt, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => onSendMessage(prompt)}
                      disabled={isLoading}
                      className="rounded-lg border border-border bg-card px-4 py-2 text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="flex flex-col space-y-4 p-4">
              {displayMessages.map((message, index) => {
                return (
                  <div
                    key={message.id ?? `msg-${index}`}
                    className={cn(
                      "flex gap-3 min-w-0",
                      message.role === "user"
                        ? "justify-end items-start"
                        : "justify-start items-start"
                    )}
                  >
                    {message.role === "assistant" && (
                      <div className="size-8 shrink-0 mt-1 rounded-full bg-primary/10 flex items-center justify-center">
                        <Sparkles className="size-4 text-primary" />
                      </div>
                    )}

                    <div
                      data-testid={message.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}
                      data-align={message.role === "user" ? "right" : "left"}
                      className={cn(
                        "chat-bubble max-w-[min(70%,38rem)] min-w-0 rounded-lg px-4 py-2.5 break-words overflow-wrap-anywhere",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      )}
                    >
                      {message.role === "assistant" ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none break-words overflow-wrap-anywhere">
                          <Streamdown>{message.content}</Streamdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-sm overflow-wrap-anywhere">
                          {message.content}
                        </p>
                      )}
                      {message.timestamp ? (
                        <p
                          className={cn(
                            "mt-1 text-[11px]",
                            message.role === "user"
                              ? "text-primary-foreground/70 text-right"
                              : "text-muted-foreground"
                          )}
                        >
                          {message.timestamp}
                        </p>
                      ) : null}
                    </div>

                    {message.role === "user" && (
                      <div className="size-8 shrink-0 mt-1 rounded-full bg-secondary flex items-center justify-center">
                        <User className="size-4 text-secondary-foreground" />
                      </div>
                    )}
                  </div>
                );
              })}

              {isLoading && (
                <div
                  className="flex items-start gap-3"
                  data-testid="chat-loading"
                  role="status"
                  aria-label="Assistant is typing"
                >
                  <div className="size-8 shrink-0 mt-1 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="size-4 text-primary" />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span>Assistant is typing…</span>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Input Area */}
      {disabled ? (
        <div className="flex gap-2 p-4 border-t bg-background/50 items-center">
          <p className="text-sm text-muted-foreground">{disabledMessage}</p>
        </div>
      ) : (
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 p-4 border-t bg-background/50 items-end"
      >
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 max-h-32 resize-none min-h-9"
          rows={1}
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send message"
          disabled={!input.trim() || isLoading}
          className="shrink-0 h-[38px] w-[38px]"
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </form>
      )}
    </div>
  );
}
