import { useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { AIChatBox } from "@/components/AIChatBox";
import { Button, Card, TierBadge } from "@/components/app/ui";
import { MeetingPanel } from "@/components/app/MeetingPanel";
import {
  QUALIFICATION_EMPTY_COPY,
  conversationErrorCopy,
  displayCustomerName,
  formatMessageTime,
  formatStatusLabel,
  isComposerDisabled,
  shouldShowComposerDisabledNote,
  toLogisticsStateRows,
  toVisibleMessages,
} from "@/components/app/conversationView";
import { useIsMutating, useMutationState, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/errors";
import { createCustomerAccess, revokeCustomerAccess } from "@/api/services/conversations";
import {
  conversationKeys,
  useAbandonConversationMutation,
  useCompleteConversationMutation,
  useConversationMessagesQuery,
  useConversationQualificationQuery,
  useConversationQuery,
  useConversationStateQuery,
  useQualifyConversationMutation,
  useSendConversationMessageMutation,
} from "@/api/hooks/useConversations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function QualificationPanel({ conversationId }: { conversationId: string }) {
  const qualification = useConversationQualificationQuery(conversationId);
  const qualify = useQualifyConversationMutation(conversationId);
  // Same-tick double-click guard (mirrors the composer): isPending flips
  // only after a render, so two clicks in one tick would fire two POSTs.
  const scoringInFlight = useRef(false);
  const scoreOnce = () => {
    if (scoringInFlight.current || qualify.isPending) return;
    scoringInFlight.current = true;
    qualify.mutate(undefined, {
      onSettled: () => {
        scoringInFlight.current = false;
      },
    });
  };
  const notFound =
    qualification.isError &&
    qualification.error instanceof ApiError &&
    qualification.error.kind === "not-found";
  return (
    <Card className="panel-card" data-testid="qualification-panel">
      <div className="panel-heading">
        <span className="panel-title">Qualification</span>
          <Button
            variant="secondary"
            onClick={() => {
              scoreOnce();
            }}
            disabled={qualify.isPending}
          >
          {qualify.isPending ? "Scoring…" : "Score now"}
        </Button>
      </div>
      {qualification.isPending ? (
        <p className="panel-note">Loading qualification…</p>
      ) : qualification.data ? (
        <div className="qual-block">
          <div className="qual-summary">
            <TierBadge tier={qualification.data.tier} />
            <span className="qual-score" data-testid="qualification-score">
              Score {qualification.data.score}
            </span>
          </div>
          <dl className="kv-list">
            <div className="kv-row">
              <dt>Score</dt>
              <dd>{qualification.data.score}</dd>
            </div>
            <div className="kv-row">
              <dt>Tier</dt>
              <dd>{qualification.data.tier}</dd>
            </div>
          </dl>
          <small className="table-sub">
            Scored {new Date(qualification.data.qualified_at).toLocaleString()}
          </small>
          <p className="panel-subheading">Criteria</p>
          <dl className="criteria-list">
            {Object.entries(qualification.data.details?.criteria ?? {}).map(([key, criterion]) => (
              <div key={key} className="criteria-row">
                <dt>{key}</dt>
                <dd>
                  {criterion.qualified ? <CheckCircle2 size={13} /> : null}
                  <span>{criterion.points} pts · {criterion.reason}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="panel-note">
          {notFound
            ? QUALIFICATION_EMPTY_COPY
            : conversationErrorCopy(qualification.error)}{" "}
          {!notFound && (
            <button className="link-btn" onClick={() => void qualification.refetch()}>
              Retry
            </button>
          )}
        </p>
      )}
      {qualify.isError ? (
        <p className="panel-error">
          {conversationErrorCopy(qualify.error)}{" "}
          <button className="link-btn" onClick={() => qualify.reset()}>Dismiss</button>
        </p>
      ) : null}
    </Card>
  );
}

export function LogisticsStatePanel({ conversationId }: { conversationId: string }) {
  const state = useConversationStateQuery(conversationId);
  // Phase 19 — conversation-derived summary in fixed sections. Every slot
  // shows its persisted value or an explicit "Not provided": nothing is
  // invented, and the panel refreshes from the state query after each send.
  const groups = useMemo(() => {
    const byLabel = new Map(
      toLogisticsStateRows(state.data ?? null).map((row) => [row.label, row.value])
    );
    const shown = (value: string | undefined): string =>
      value === undefined || value === "—" || value.trim().length === 0
        ? "Not provided"
        : value;
    const pick = (...labels: string[]) =>
      labels.map((label) => ({ label, value: shown(byLabel.get(label)) }));
    return [
      { heading: "CUSTOMER", rows: pick("Customer") },
      {
        heading: "SHIPMENT",
        rows: pick("Pickup", "Destination", "Vehicle", "Cargo", "Weight", "Dimensions", "Delivery date"),
      },
      { heading: "COMMERCIAL", rows: pick("Budget") },
      { heading: "INTENT", rows: pick("Urgency", "Booking intent") },
      { heading: "ADDITIONAL", rows: pick("Notes") },
    ];
  }, [state.data]);
  return (
    <Card className="panel-card" data-testid="logistics-panel">
      <div className="panel-heading"><span className="panel-title">Logistics details</span></div>
      {state.isPending ? (
        <p className="panel-note">Loading details…</p>
      ) : (
        <div className="state-groups">
          {groups.map((group) => (
            <div key={group.heading}>
              <p className="panel-subheading">{group.heading}</p>
              <dl className="state-list">
                {group.rows.map((row) => (
                  <div key={row.label} className="state-row">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          <p className="panel-note">Source: this conversation.</p>
        </div>
      )}
      {state.isError ? (
        <p className="panel-error">
          {conversationErrorCopy(state.error)}{" "}
          <button className="link-btn" onClick={() => void state.refetch()}>Retry</button>
        </p>
      ) : null}
    </Card>
  );
}

export function ConversationStatusPanel({
  conversationId,
  status,
}: {
  conversationId: string;
  status: string | undefined;
}) {
  const complete = useCompleteConversationMutation(conversationId);
  const abandon = useAbandonConversationMutation(conversationId);
  const actionsDisabled = status !== "active";
  return (
    <Card className="panel-card" data-testid="status-panel">
      <div className="panel-heading"><span className="panel-title">Status</span></div>
      <dl className="kv-list">
        <div className="kv-row">
          <dt>Status</dt>
          <dd data-testid="status-value">{status ? formatStatusLabel(status) : "…"}</dd>
        </div>
      </dl>
      <div className="panel-actions">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="secondary" disabled={actionsDisabled || complete.isPending}>
              Complete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Complete this conversation?</AlertDialogTitle>
              <AlertDialogDescription>
                The conversation closes and the composer disables. History is preserved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => complete.mutate()} disabled={complete.isPending}>
                {complete.isPending ? "Completing…" : "Complete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="secondary" disabled={actionsDisabled || abandon.isPending}>
              Abandon
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Abandon this conversation?</AlertDialogTitle>
              <AlertDialogDescription>
                The conversation closes without scoring. History is preserved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => abandon.mutate()} disabled={abandon.isPending}>
                {abandon.isPending ? "Abandoning…" : "Abandon"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {complete.isError || abandon.isError ? (
        <p className="panel-error">{conversationErrorCopy(complete.error ?? abandon.error)}</p>
      ) : null}
    </Card>
  );
}

/**
 * Phase 20 — customer share link for one conversation (internal owners).
 *
 * Generates a single-conversation /chat/<token> link via the backend (the
 * raw token is returned once and never stored), shows it for copying with
 * its expiry, and revokes it on demand. Revocation cuts customer access
 * immediately; history is untouched.
 */
export function CustomerChatShare({ conversationId }: { conversationId: string }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setLink(await createCustomerAccess(conversationId));
    } catch (err) {
      setError(err instanceof ApiError ? conversationErrorCopy(err) : "Couldn’t create the link.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await revokeCustomerAccess(conversationId);
      setLink(null);
    } catch (err) {
      setError(err instanceof ApiError ? conversationErrorCopy(err) : "Couldn’t revoke access.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card className="panel-card" data-testid="customer-share">
      <div className="panel-heading"><span className="panel-title">Customer chat</span></div>
      <p className="panel-note">
        Share a link that opens only this conversation — no dashboard, leads, or settings.
      </p>
      {!link ? (
        <div className="panel-actions">
          <Button variant="secondary" onClick={() => void generate()} disabled={busy}>
            {busy ? "Creating…" : "Generate customer link"}
          </Button>
        </div>
      ) : (
        <>
          <div className="meeting-field">
            <label className="field-label" htmlFor="customer-chat-link">Share link</label>
            <input id="customer-chat-link" value={link.url} readOnly className="text-input" />
          </div>
          <p className="panel-note">Expires {new Date(link.expiresAt).toLocaleString()}</p>
          <div className="panel-actions">
            <Button variant="secondary" onClick={() => void copy()} disabled={busy}>
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button variant="secondary" onClick={() => void revoke()} disabled={busy}>
              {busy ? "Revoking…" : "Revoke access"}
            </Button>
          </div>
        </>
      )}
      {error ? <p className="panel-error">{error}</p> : null}
    </Card>
  );
}

function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendUnauthorized, setSendUnauthorized] = useState(false);

  const detail = useConversationQuery(id);
  const messages = useConversationMessagesQuery(id, 100);
  const queryClient = useQueryClient();
  // Shared cache with LogisticsStatePanel: supplies the customer_name
  // fallback for the header without an extra endpoint.
  const headerState = useConversationStateQuery(id);
  const send = useSendConversationMessageMutation(id ?? "");
  // Synchronous in-flight guard: props (send.isPending) update only after a
  // render, so a rapid double Enter/click in the same tick would otherwise
  // fire two POSTs. The ref flips synchronously inside the handler.
  const sendInFlight = useRef(false);
  // Idempotency key of the last failed submit: an explicit retry reuses it
  // so a timeout-then-retry replays the original rows instead of doubling
  // them. Fresh submits always mint a new key (identical texts stay distinct).
  const failedSendKey = useRef<string | null>(null);
  // The failed text itself: the composer clears on submit, so the page keeps
  // a copy to power the explicit Retry (the old "kept above" note was false).
  const [failedContent, setFailedContent] = useState<string | null>(null);
  const sendKey = useMemo(() => conversationKeys.sendMessage(id ?? ""), [id]);

  /**
   * Navigation-durable send state (global MutationCache, not mount state):
   * - `orphanPending`: a send fired before navigating away is still running.
   *   The typing indicator and composer lock follow it, and the guard below
   *   blocks overlapping sends until it settles.
   * - `cachedFailure`: the latest failed send for this conversation, so a
   *   return after a failure still offers the truthful same-key Retry.
   * History itself always comes from the messages query (server truth).
   */
  const orphanPendingCount = useIsMutating({ mutationKey: sendKey });
  const sendPending = send.isPending || orphanPendingCount > 0;
  const cachedFailures = useMutationState({
    filters: { mutationKey: sendKey, status: "error" },
    select: (mutation) => {
      const vars = (mutation.state.variables ?? {}) as {
        content?: unknown;
        idempotencyKey?: unknown;
      };
      if (typeof vars.content !== "string") return null;
      const err = mutation.state.error;
      return {
        content: vars.content,
        idempotencyKey:
          typeof vars.idempotencyKey === "string" ? vars.idempotencyKey : null,
        submittedAt: mutation.state.submittedAt,
        message:
          err instanceof ApiError ? conversationErrorCopy(err) : "Couldn’t send your message.",
        unauthorized: err instanceof ApiError && err.kind === "unauthorized",
      };
    },
  });
  const cachedFailure =
    [...cachedFailures].reverse().find((entry) => entry !== null) ?? null;
  /**
   * Stale-error suppression: a client-side failure (e.g. timeout) can still
   * mean the backend completed. If a user message with the failed content
   * was persisted at/after submit, the send landed — hide the retry instead
   * of inviting a confusing duplicate. Same-key retry stays safe regardless
   * (the server replays completed turns).
   */
  const failureCompletedServerSide = useMemo(() => {
    if (!cachedFailure || !messages.data?.messages) return false;
    const cutoff = cachedFailure.submittedAt - 2000;
    return messages.data.messages.some(
      (m) =>
        m.role === "user" &&
        m.content === cachedFailure.content &&
        new Date(m.created_at).getTime() >= cutoff
    );
  }, [cachedFailure, messages.data]);
  const visibleCachedFailure = failureCompletedServerSide ? null : cachedFailure;
  const effectiveSendError = sendError ?? visibleCachedFailure?.message ?? null;
  const effectiveSendUnauthorized =
    sendUnauthorized || visibleCachedFailure?.unauthorized === true;
  const effectiveFailedContent = failedContent ?? visibleCachedFailure?.content ?? null;
  const effectiveRetryKey =
    failedSendKey.current ?? visibleCachedFailure?.idempotencyKey ?? undefined;

  const conversation = detail.data?.conversation ?? null;
  const lead = detail.data?.lead ?? null;
  const status = conversation?.status;
  const customerName = displayCustomerName(lead?.name, headerState.data?.customer_name);
  const composerDisabled = isComposerDisabled(status) || sendPending;
  const messageCount = detail.data?.messageCount ?? messages.data?.messages?.length ?? 0;
  const latestActivity = conversation?.updated_at ?? conversation?.created_at ?? null;

  const visible = useMemo(
    () =>
      toVisibleMessages(messages.data?.messages ?? []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: formatMessageTime(m.created_at),
      })),
    [messages.data]
  );

  const handleSend = (content: string, idempotencyKey?: string) => {
    // sendPending covers this mount AND an orphaned send from before a
    // navigation: never overlap turns, never duplicate rows.
    if (sendInFlight.current || sendPending) return;
    sendInFlight.current = true;
    setSendError(null);
    setSendUnauthorized(false);
    const key = idempotencyKey ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    send.mutate(
      { content, idempotencyKey: key },
      {
        onSuccess: (result) => {
          failedSendKey.current = null;
          setFailedContent(null);
          // The landed content supersedes settled error entries for the
          // same text (e.g. a same-key retry after returning): remove them
          // so a stale Retry never lingers next to the completed result.
          const landed = result.userMessage.content;
          const mutationCache = queryClient.getMutationCache();
          mutationCache
            .findAll({ mutationKey: sendKey, status: "error" })
            .forEach((mutation) => {
              const vars = (mutation.state.variables ?? {}) as {
                content?: unknown;
              };
              if (vars.content === landed) mutationCache.remove(mutation);
            });
        },
        onError: (error) => {
          // Session auth refreshes once-and-retries inside the service; a
          // surviving 401 means signed-out — offer Sign in, never a token modal.
          setSendUnauthorized(error instanceof ApiError && error.kind === "unauthorized");
          setSendError(conversationErrorCopy(error));
          // Keep the key so the explicit Retry below replays, not duplicates.
          failedSendKey.current = key;
          setFailedContent(content);
        },
        onSettled: () => {
          sendInFlight.current = false;
        },
      }
    );
  };

  const handleRetrySend = (content: string) => {
    handleSend(content, effectiveRetryKey);
  };

  if (!id) {
    return <Card className="table-card"><div className="empty-state"><b>Conversation not found.</b></div></Card>;
  }

  return (
    <div className="conversation-page" data-testid="conversation-detail">
      <button className="back-link" onClick={() => navigate("/conversations")}>
        <ArrowLeft size={14} /> Back to Conversations
      </button>

      <div className="conversation-header card" data-testid="conversation-header">
        <div className="conversation-header-main">
          <p className="section-kicker">TEXT CONVERSATION</p>
          <h2 className="conversation-title" data-testid="conversation-title">
            {detail.isPending ? "Loading conversation…" : customerName}
          </h2>
          <div className="conversation-meta">
            {conversation ? (
              <>
                <span className={`status-chip status-${conversation.status}`} data-testid="conversation-status">
                  {formatStatusLabel(conversation.status)}
                </span>
                <span className="meta-chip" data-testid="conversation-channel">{conversation.channel}</span>
                <span className="meta-text" data-testid="conversation-count">
                  {messageCount} {messageCount === 1 ? "message" : "messages"}
                </span>
                {latestActivity ? (
                  <span className="meta-text" data-testid="conversation-activity">
                    Active {new Date(latestActivity).toLocaleString()}
                  </span>
                ) : null}
              </>
            ) : detail.isError ? (
              <span className="meta-text">{conversationErrorCopy(detail.error)}</span>
            ) : (
              <span className="meta-text">Loading conversation…</span>
            )}
          </div>
        </div>
        {conversation ? (
          <span className="conversation-id" title={conversation.id} data-testid="conversation-id">
            {conversation.id.slice(0, 8)}…
          </span>
        ) : null}
      </div>

      <div className="conversation-layout">
        <div className="conversation-main">
          {detail.isPending ? (
            <Card className="table-card"><div className="empty-state"><b>Loading conversation…</b></div></Card>
          ) : detail.isError || !conversation ? (
            <Card className="table-card"><div className="empty-state"><b>Couldn&apos;t load this conversation</b><span>{conversationErrorCopy(detail.error)}</span><Button variant="secondary" onClick={() => { void detail.refetch(); }}>Retry</Button></div></Card>
          ) : (
            <>
              {messages.isError ? (
                <Card className="table-card"><div className="empty-state"><b>Couldn&apos;t load messages</b><span>{conversationErrorCopy(messages.error)}</span><Button variant="secondary" onClick={() => { void messages.refetch(); }}>Retry</Button></div></Card>
              ) : (
                <AIChatBox
                  messages={visible}
                  onSendMessage={handleSend}
                  isLoading={sendPending}
                  disabled={isComposerDisabled(status)}
                  placeholder={
                    isComposerDisabled(status)
                      ? `This conversation is ${formatStatusLabel(status).toLowerCase()}.`
                      : "Type your message… (Enter sends, Shift+Enter newline)"
                  }
                  disabledMessage={
                    status
                      ? `Messaging is disabled because this conversation is ${formatStatusLabel(status).toLowerCase()}. History is preserved above.`
                      : "This conversation is no longer active."
                  }
                  emptyStateMessage="No messages yet — say hello below."
                  suggestedPrompts={
                    visible.length === 0
                      ? ["I need to ship cargo from Chennai", "What vehicles do you provide?"]
                      : undefined
                  }
                />
              )}
              {effectiveSendError ? (
                <p className="panel-error chat-error" role="alert">
                  <AlertTriangle size={14} /> {effectiveSendError}{" "}
                  {effectiveSendUnauthorized ? (
                    <button className="link-btn" onClick={() => navigate("/login")}>
                      Sign in
                    </button>
                  ) : effectiveFailedContent ? (
                    <button
                      className="link-btn"
                      disabled={sendPending}
                      onClick={() => handleRetrySend(effectiveFailedContent)}
                    >
                      {sendPending ? "Retrying…" : "Retry send"}
                    </button>
                  ) : null}
                </p>
              ) : null}
              {shouldShowComposerDisabledNote(status) ? (
                <p className="panel-note" data-testid="composer-disabled-note">
                  Messaging is disabled because this conversation is {formatStatusLabel(status).toLowerCase()}.
                </p>
              ) : null}
            </>
          )}
        </div>
        <aside className="conversation-side">
          <ConversationStatusPanel conversationId={id} status={status} />
          <CustomerChatShare conversationId={id} />
          <Card className="panel-card" data-testid="lead-panel">
            <div className="panel-heading"><span className="panel-title">Lead</span></div>
            {detail.isPending ? (
              <p className="panel-note">Loading lead…</p>
            ) : lead ? (
              <dl className="kv-list">
                <div className="kv-row">
                  <dt>Name</dt>
                  <dd>{lead.name}</dd>
                </div>
                <div className="kv-row">
                  <dt>Phone</dt>
                  <dd>{lead.phone}</dd>
                </div>
                <div className="kv-row">
                  <dt>Status</dt>
                  <dd>{lead.status}</dd>
                </div>
              </dl>
            ) : (
              <p className="panel-note">No lead linked to this conversation.</p>
            )}
            {conversation?.lead_id ? (
              <button className="link-btn" onClick={() => navigate(`/leads/${conversation.lead_id}`)}>
                Open lead →
              </button>
            ) : null}
          </Card>
          <QualificationPanel conversationId={id} />
          <LogisticsStatePanel conversationId={id} />
          <MeetingPanel
            conversationId={id}
            schedulable={status === "active" || status === "completed"}
            schedulableReason={
              status === "abandoned"
                ? "Meetings cannot be scheduled because this conversation was abandoned."
                : "Meetings can be scheduled once the conversation loads."
            }
          />
        </aside>
      </div>
    </div>
  );
}

export default ConversationDetailPage;
