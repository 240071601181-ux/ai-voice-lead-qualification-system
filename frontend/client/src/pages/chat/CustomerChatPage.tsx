import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { LogOut } from "lucide-react";
import { AIChatBox } from "@/components/AIChatBox";
import { Button, Card } from "@/components/app/ui";
import { MeetingPanel } from "@/components/app/MeetingPanel";
import {
  conversationErrorCopy,
  formatMessageTime,
  toLogisticsStateRows,
  toVisibleMessages,
} from "@/components/app/conversationView";
import { ApiError } from "@/api/errors";
import {
  customerMeetingHooks,
  useCustomerConversationQuery,
  useCustomerLogoutMutation,
  useCustomerMessagesQuery,
  useCustomerQualificationQuery,
  useCustomerStateQuery,
  useRedeemCustomerSessionMutation,
  useSendCustomerMessageMutation,
} from "@/api/hooks/useCustomer";

/**
 * Phase 20 — external customer chat (NOT the admin shell).
 *
 * Two modes on one component:
 * - `/chat/:token`: redeems the share link into an HttpOnly-cookie session,
 *   then drops the token from the visible URL (history replace to /chat).
 * - `/chat`: the session chat itself (cookie-authenticated).
 *
 * Renders no admin chrome: no sidebar, no dashboard/leads/CRM/settings
 * navigation, no other conversations. Everything shown comes from the
 * customer's own conversation records; the composer, state panel, and
 * meeting section all run through the customer-scoped endpoints.
 */
function useIdempotencyKey() {
  return () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
}

function ShipmentSummary() {
  const state = useCustomerStateQuery();
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
      { heading: "SHIPMENT", rows: pick("Pickup", "Destination", "Vehicle", "Cargo", "Weight", "Dimensions", "Delivery date") },
      { heading: "COMMERCIAL", rows: pick("Budget") },
      { heading: "INTENT", rows: pick("Urgency", "Booking intent") },
    ];
  }, [state.data]);
  return (
    <Card className="panel-card" data-testid="customer-shipment">
      <div className="panel-heading"><span className="panel-title">Shipment details</span></div>
      {state.isPending ? (
        <p className="panel-note">Loading details…</p>
      ) : state.isError ? (
        <p className="panel-error">
          {conversationErrorCopy(state.error)}{" "}
          <button className="link-btn" onClick={() => void state.refetch()}>Retry</button>
        </p>
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
        </div>
      )}
    </Card>
  );
}

function CustomerChat({ onLogout }: { onLogout: () => void }) {
  const detail = useCustomerConversationQuery();
  const messages = useCustomerMessagesQuery();
  const qualification = useCustomerQualificationQuery();
  const send = useSendCustomerMessageMutation();
  const logout = useCustomerLogoutMutation();
  const sendInFlight = useRef(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failedContent, setFailedContent] = useState<string | null>(null);
  const failedSendKey = useRef<string | null>(null);
  const newKey = useIdempotencyKey();

  const status = detail.data?.status;
  const composerDisabled = status !== undefined && status !== "active";

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
    if (sendInFlight.current || send.isPending) return;
    sendInFlight.current = true;
    setSendError(null);
    const key = idempotencyKey ?? newKey();
    send.mutate(
      { content, idempotencyKey: key },
      {
        onSuccess: () => {
          failedSendKey.current = null;
          setFailedContent(null);
        },
        onError: (error) => {
          setSendError(conversationErrorCopy(error));
          failedSendKey.current = key;
          setFailedContent(content);
        },
        onSettled: () => {
          sendInFlight.current = false;
        },
      }
    );
  };

  const handleLogout = () => {
    logout.mutate(undefined, { onSettled: () => onLogout() });
  };

  if (detail.isPending) {
    return (
      <div className="chat-shell" data-testid="customer-chat">
        <p className="panel-note">Loading your conversation…</p>
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    const unauthorized =
      detail.error instanceof ApiError && detail.error.kind === "unauthorized";
    return (
      <div className="chat-shell" data-testid="customer-chat">
        <div className="chat-card">
          <h1>MadLead AI</h1>
          <p className="panel-note">
            {unauthorized
              ? "This chat link is invalid, expired, or revoked. Please ask the sender for a new link."
              : conversationErrorCopy(detail.error)}
          </p>
          {!unauthorized ? (
            <Button variant="secondary" onClick={() => void detail.refetch()}>Retry</Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-shell" data-testid="customer-chat">
      <header className="chat-header">
        <div>
          <p className="section-kicker">MADLEAD AI</p>
          <h1>Shipment assistant</h1>
        </div>
        <button className="link-btn" onClick={handleLogout} aria-label="Sign out of chat">
          <LogOut size={14} /> Sign out
        </button>
      </header>
      <div className="chat-layout">
        <div className="chat-main">
          {messages.isError ? (
            <Card className="table-card">
              <div className="empty-state">
                <b>Couldn&apos;t load messages</b>
                <span>{conversationErrorCopy(messages.error)}</span>
                <Button variant="secondary" onClick={() => void messages.refetch()}>Retry</Button>
              </div>
            </Card>
          ) : (
            <AIChatBox
              messages={visible}
              onSendMessage={handleSend}
              isLoading={send.isPending}
              disabled={composerDisabled}
              placeholder={composerDisabled ? "This conversation is closed." : "Type your message…"}
              disabledMessage="This conversation is closed. History is preserved above."
              emptyStateMessage="Start a conversation with AI"
            />
          )}
          {sendError ? (
            <p className="panel-error chat-error" role="alert">
              {sendError}{" "}
              {failedContent ? (
                <button
                  className="link-btn"
                  disabled={send.isPending}
                  onClick={() => handleSend(failedContent, failedSendKey.current ?? undefined)}
                >
                  {send.isPending ? "Retrying…" : "Retry send"}
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
        <aside className="chat-side">
          <ShipmentSummary />
          {qualification.data ? (
            <Card className="panel-card" data-testid="customer-qualification">
              <div className="panel-heading"><span className="panel-title">Qualification</span></div>
              <p className="panel-note">
                Tier {qualification.data.tier} · Score {qualification.data.score}
              </p>
            </Card>
          ) : null}
          <MeetingPanel
            conversationId={detail.data.id}
            schedulable={status === "active" || status === "completed"}
            schedulableReason="Meetings cannot be scheduled because this conversation is closed."
            hooks={customerMeetingHooks}
          />
        </aside>
      </div>
    </div>
  );
}

export default function CustomerChatPage() {
  const params = useParams<{ token?: string }>();
  const [, navigate] = useLocation();
  const token = params.token;
  const [signedOut, setSignedOut] = useState(false);
  const redeem = useRedeemCustomerSessionMutation();
  const attempted = useRef<string | null>(null);

  // Redeem once per token: success drops the token from the URL (replace to
  // /chat), failure renders the invalid-link state below.
  useEffect(() => {
    if (!token || attempted.current === token || redeem.isPending) return;
    attempted.current = token;
    redeem.mutate(token, {
      onSuccess: () => navigate("/chat", { replace: true }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (signedOut) {
    return (
      <div className="chat-shell" data-testid="customer-chat">
        <div className="chat-card">
          <h1>MadLead AI</h1>
          <p className="panel-note">You have signed out of this chat.</p>
        </div>
      </div>
    );
  }

  if (token) {
    if (redeem.isPending || redeem.isIdle) {
      return (
        <div className="chat-shell" data-testid="customer-chat">
          <p className="panel-note">Opening your conversation…</p>
        </div>
      );
    }
    return (
      <div className="chat-shell" data-testid="customer-chat">
        <div className="chat-card">
          <h1>MadLead AI</h1>
          <p className="panel-note">
            This chat link is invalid, expired, or revoked. Please ask the sender for a new link.
          </p>
          <Button variant="secondary" onClick={() => redeem.mutate(token)}>Retry</Button>
        </div>
      </div>
    );
  }

  return <CustomerChat onLogout={() => setSignedOut(true)} />;
}
