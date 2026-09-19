import { useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { AIChatBox } from "@/components/AIChatBox";
import { Button, Card, TierBadge } from "@/components/app/ui";
import { MeetingPanel } from "@/components/app/MeetingPanel";
import {
  LOGISTICS_EMPTY_COPY,
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
import { ApiError } from "@/api/errors";
import {
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
            if (!qualify.isPending) qualify.mutate();
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

function LogisticsStatePanel({ conversationId }: { conversationId: string }) {
  const state = useConversationStateQuery(conversationId);
  const rows = useMemo(() => toLogisticsStateRows(state.data ?? null), [state.data]);
  return (
    <Card className="panel-card" data-testid="logistics-panel">
      <div className="panel-heading"><span className="panel-title">Logistics details</span></div>
      {state.isPending ? (
        <p className="panel-note">Loading details…</p>
      ) : rows.length === 0 ? (
        <p className="panel-note">{LOGISTICS_EMPTY_COPY}</p>
      ) : (
        <dl className="state-list">
          {rows.map((row) => (
            <div key={row.label} className="state-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
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

function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendUnauthorized, setSendUnauthorized] = useState(false);

  const detail = useConversationQuery(id);
  const messages = useConversationMessagesQuery(id, 100);
  // Shared cache with LogisticsStatePanel: supplies the customer_name
  // fallback for the header without an extra endpoint.
  const headerState = useConversationStateQuery(id);
  const send = useSendConversationMessageMutation(id ?? "");

  const conversation = detail.data?.conversation ?? null;
  const lead = detail.data?.lead ?? null;
  const status = conversation?.status;
  const customerName = displayCustomerName(lead?.name, headerState.data?.customer_name);
  const composerDisabled = isComposerDisabled(status) || send.isPending;
  const messageCount = detail.data?.messageCount ?? messages.data?.messages?.length ?? 0;
  const latestActivity = conversation?.updated_at ?? conversation?.created_at ?? null;

  const visible = useMemo(
    () =>
      toVisibleMessages(messages.data?.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: formatMessageTime(m.created_at),
      })),
    [messages.data]
  );

  const handleSend = (content: string) => {
    setSendError(null);
    setSendUnauthorized(false);
    send.mutate(content, {
      onError: (error) => {
        // Session auth refreshes once-and-retries inside the service; a
        // surviving 401 means signed-out — offer Sign in, never a token modal.
        setSendUnauthorized(error instanceof ApiError && error.kind === "unauthorized");
        setSendError(conversationErrorCopy(error));
      },
    });
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
                  isLoading={send.isPending}
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
              {sendError ? (
                <p className="panel-error chat-error" role="alert">
                  <AlertTriangle size={14} /> {sendError}{" "}
                  {sendUnauthorized ? (
                    <button className="link-btn" onClick={() => navigate("/login")}>
                      Sign in
                    </button>
                  ) : (
                    <span className="panel-note">Your text is kept above — resend when ready.</span>
                  )}
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
