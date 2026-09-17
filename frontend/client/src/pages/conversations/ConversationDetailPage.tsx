import { useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AIChatBox } from "@/components/AIChatBox";
import { Button, Card, TierBadge } from "@/components/app/ui";
import { MeetingPanel } from "@/components/app/MeetingPanel";
import {
  conversationErrorCopy,
  formatMessageTime,
  isComposerDisabled,
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

function QualificationPanel({ conversationId }: { conversationId: string }) {
  const qualification = useConversationQualificationQuery(conversationId);
  const qualify = useQualifyConversationMutation(conversationId);
  const notFound =
    qualification.isError &&
    qualification.error instanceof ApiError &&
    qualification.error.kind === "not-found";
  return (
    <Card className="panel-card">
      <div className="panel-heading">
        <b>Qualification</b>
        <Button
          variant="secondary"
          onClick={() => qualify.mutate()}
          disabled={qualify.isPending}
        >
          {qualify.isPending ? "Scoring…" : "Score now"}
        </Button>
      </div>
      {qualification.isPending ? (
        <p className="panel-note">Loading qualification…</p>
      ) : qualification.data ? (
        <div className="qual-block">
          <TierBadge tier={qualification.data.tier} />
          <b className="qual-score">{qualification.data.score}</b>
          <small className="table-sub">
            Scored {new Date(qualification.data.qualified_at).toLocaleString()}
          </small>
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
            ? "Not scored yet — it appears automatically once enough details are known."
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
    <Card className="panel-card">
      <div className="panel-heading"><b>Logistics details</b></div>
      {state.isPending ? (
        <p className="panel-note">Loading details…</p>
      ) : rows.length === 0 ? (
        <p className="panel-note">
          No structured details yet — they appear as the assistant confirms them.
        </p>
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

function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendUnauthorized, setSendUnauthorized] = useState(false);

  const detail = useConversationQuery(id);
  const messages = useConversationMessagesQuery(id, 100);
  const send = useSendConversationMessageMutation(id ?? "");
  const complete = useCompleteConversationMutation(id ?? "");
  const abandon = useAbandonConversationMutation(id ?? "");

  const conversation = detail.data?.conversation ?? null;
  const lead = detail.data?.lead ?? null;
  const status = conversation?.status;
  const composerDisabled = isComposerDisabled(status) || send.isPending;

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
    <div className="conversation-layout">
      <div className="conversation-main">
        <div className="page-heading">
          <div>
            <p className="lede">
              {conversation
                ? `${conversation.channel} · ${conversation.status} · ${detail.data?.messageCount ?? 0} messages`
                : "Loading conversation…"}
            </p>
          </div>
        </div>
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
                placeholder="Type your message… (Enter sends, Shift+Enter newline)"
                emptyStateMessage="No messages yet — say hello below."
                suggestedPrompts={
                  visible.length === 0
                    ? ["I need to ship cargo from Chennai", "What vehicles do you provide?"]
                    : undefined
                }
              />
            )}
            {sendError ? (
              <p className="panel-error" role="alert">
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
            {composerDisabled && status !== "active" ? (
              <p className="panel-note">Messaging is disabled because this conversation is {status}.</p>
            ) : null}
          </>
        )}
      </div>
      <aside className="conversation-side">
        <Card className="panel-card">
          <div className="panel-heading"><b>Status</b><small className="table-sub">{status ?? "…"}</small></div>
          {conversation ? (
            <div className="panel-actions">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="secondary" disabled={status !== "active" || complete.isPending}>
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
                    <AlertDialogAction onClick={() => complete.mutate()}>Complete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="secondary" disabled={status !== "active" || abandon.isPending}>
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
                    <AlertDialogAction onClick={() => abandon.mutate()}>Abandon</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
          {complete.isError || abandon.isError ? (
            <p className="panel-error">{conversationErrorCopy(complete.error ?? abandon.error)}</p>
          ) : null}
        </Card>
        <Card className="panel-card">
          <div className="panel-heading"><b>Lead</b></div>
          {detail.isPending ? (
            <p className="panel-note">Loading lead…</p>
          ) : lead ? (
            <div className="lead-block">
              <b>{lead.name}</b>
              <small className="table-sub">{lead.phone}</small>
              <small className="table-sub">{lead.status}</small>
              {conversation?.lead_id ? (
                <button className="link-btn" onClick={() => navigate(`/leads/${conversation.lead_id}`)}>
                  Open lead →
                </button>
              ) : null}
            </div>
          ) : (
            <p className="panel-note">No lead linked to this conversation.</p>
          )}
        </Card>
        <QualificationPanel conversationId={id} />
        <LogisticsStatePanel conversationId={id} />
        <MeetingPanel conversationId={id} />
      </aside>
    </div>
  );
}

export default ConversationDetailPage;
