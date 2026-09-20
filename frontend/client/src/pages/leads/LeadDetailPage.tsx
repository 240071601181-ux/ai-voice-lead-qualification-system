import { useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { ChevronLeft, MessageSquareText, Pencil } from "lucide-react";
import { Button, Card } from "@/components/app/ui";
import { useToast } from "@/layouts/AppLayout";
import { NotFoundState } from "@/components/app/NotFoundState";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeadDetail } from "@/api/hooks/useLeads";
import { initialsForName } from "@/api/hooks/leadDisplay";
import { useConversationsQuery, useCreateConversationMutation } from "@/api/hooks/useConversations";
import { useConversationStateQuery } from "@/api/hooks/useConversations";
import { QualificationPanel } from "@/pages/conversations/ConversationDetailPage";
import { MeetingPanel } from "@/components/app/MeetingPanel";
import {
  conversationErrorCopy,
  toLogisticsStateRows,
} from "@/components/app/conversationView";
import { getUserMessage } from "@/api/errors";

/**
 * Phase 19 — conversation-first integrity on the Lead Details page.
 *
 * Every value rendered here comes from a live backend record:
 * - CUSTOMER from GET /api/v1/leads/:id (name / phone / email / status).
 * - SHIPMENT from the latest conversation's GET .../state (user-provided
 *   slots only; unknown fields read "Not provided").
 * - QUALIFICATION from the latest conversation's persisted qualification.
 * - ACTIVITY from the real conversation list.
 *
 * There is no demo/mock fallback: unknown backend data renders loading,
 * not-found, error, or "Not available" states — never invented logistics,
 * scores, threads, or recommendations.
 */

export function StartConversationButton({ leadId, onToast }: { leadId: string | null; onToast: (message: string) => void }) {
  const [, navigate] = useLocation();
  const create = useCreateConversationMutation();
  const handleStart = () => {
    if (create.isPending) return;
    if (!leadId) {
      onToast("No lead record available for a conversation.");
      return;
    }
    create.mutate(
      { leadId, channel: "web" },
      {
        onSuccess: (conversation) => navigate(`/conversations/${conversation.id}`),
        onError: (error) => onToast(conversationErrorCopy(error)),
      }
    );
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Button icon={MessageSquareText} variant="primary" onClick={handleStart} disabled={create.isPending || !leadId}>
        {create.isPending ? "Starting…" : "Start conversation"}
      </Button>
    </span>
  );
}

/** Real conversation history for a lead (GET /api/v1/conversations?leadId). */
export function LeadConversationsPanel({ leadId }: { leadId: string | null }) {
  const [, navigate] = useLocation();
  const list = useConversationsQuery({ leadId: leadId ?? undefined, page: 1, limit: 20 });
  if (!leadId) return <Card className="tab-panel"><div className="empty-state"><b>No conversations yet.</b></div></Card>;
  if (list.isPending) return <Card className="tab-panel"><div className="empty-state"><b>Loading conversations…</b></div></Card>;
  if (list.isError) return <Card className="tab-panel"><div className="empty-state"><b>Couldn&apos;t load conversations</b><span>{conversationErrorCopy(list.error)}</span><Button variant="secondary" onClick={() => { void list.refetch(); }}>Retry</Button></div></Card>;
  const rows = list.data?.conversations ?? [];
  if (rows.length === 0) return <Card className="tab-panel"><div className="empty-state"><b>No conversations yet.</b><span>Start the first conversation above.</span></div></Card>;
  return <Card className="tab-panel"><div className="card-header"><div><span className="section-kicker">TEXT CONVERSATIONS</span><h2>Conversation history</h2></div></div><div className="table-wrap"><table><thead><tr><th>Status</th><th>Channel</th><th>Last activity</th></tr></thead><tbody>{rows.map((c) => <tr key={c.id} onClick={() => navigate(`/conversations/${c.id}`)}><td><small className="table-sub">{c.status}</small></td><td><small className="table-sub">{c.channel}</small></td><td><small className="table-sub">{new Date(c.updated_at).toLocaleString()}</small></td></tr>)}</tbody></table></div></Card>;
}

const NOT_PROVIDED = "Not provided";
const asProvided = (value: string): string =>
  value === "—" || value.trim().length === 0 ? NOT_PROVIDED : value;

/** Conversation-derived shipment slots; honest "Not provided" per field. */
function ShipmentPanel({ conversationId }: { conversationId: string | null }) {
  const state = useConversationStateQuery(conversationId ?? undefined);
  const rows = useMemo(
    () =>
      toLogisticsStateRows(state.data ?? null).map((row) => ({
        ...row,
        value: asProvided(row.value),
      })),
    [state.data]
  );
  const groups = useMemo(() => {
    const byLabel = new Map(rows.map((r) => [r.label, r.value]));
    const pick = (...labels: string[]) =>
      labels.map((label) => ({ label, value: byLabel.get(label) ?? NOT_PROVIDED }));
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
  }, [rows]);
  return (
    <Card className="panel-card" data-testid="shipment-panel">
      <div className="panel-heading"><span className="panel-title">Shipment details</span></div>
      {conversationId === null ? (
        <p className="panel-note">Not available — no conversation recorded for this lead yet.</p>
      ) : state.isPending ? (
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
          <p className="panel-note">Source: this lead&apos;s latest conversation.</p>
        </div>
      )}
    </Card>
  );
}

function NotAvailable({ what }: { what: string }) {
  return (
    <Card className="tab-panel">
      <div className="empty-state">
        <b>Not available</b>
        <span>{what}</span>
      </div>
    </Card>
  );
}

export default function LeadDetailPage() {
  const { notify } = useToast();
  const params = useParams();
  const [, navigate] = useLocation();
  const id = params.id ?? "";
  const detail = useLeadDetail(id);
  // Latest conversation drives the conversation-derived sections below.
  // Hooks run unconditionally to keep hook order stable across states.
  const latestQuery = useConversationsQuery({ leadId: id || undefined, page: 1, limit: 1 });

  if (detail.status === "loading") {
    return (
      <>
        <button className="back-link" onClick={() => navigate("/leads")}><ChevronLeft size={15} />Back to leads</button>
        <Card className="lead-hero">
          <div className="lead-hero-main" style={{ width: "100%" }}>
            <Skeleton className="h-12 w-12 rounded-full" />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-72" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        </Card>
        <Card className="tab-panel">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-24 w-full" />
        </Card>
      </>
    );
  }

  if (detail.status === "not-found") return <NotFoundState label="Lead" backPath="/leads" />;

  if (detail.status === "error") {
    return (
      <>
        <button className="back-link" onClick={() => navigate("/leads")}><ChevronLeft size={15} />Back to leads</button>
        <Card className="tab-panel">
          <div className="empty-state">
            <span className="section-kicker">ERROR</span>
            <b>Couldn&apos;t load this lead</b>
            <span>{getUserMessage(detail.error)}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" onClick={() => navigate("/leads")}>Back to leads</Button>
              <Button variant="primary" onClick={detail.refetch}>Retry</Button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  const apiLead = detail.apiLead;
  const latest = latestQuery.data?.conversations?.[0] ?? null;
  const latestId = latest?.id ?? null;
  return (
    <LeadDetailView
      leadId={apiLead.id}
      name={apiLead.name}
      phone={apiLead.phone}
      email={apiLead.email ?? null}
      status={apiLead.status}
      source={apiLead.source}
      createdAt={apiLead.created_at}
      latestId={latestId}
      latestStatus={latest?.status}
      conversationsPending={latestQuery.isPending}
      onToast={notify}
    />
  );
}

function LeadDetailView({
  leadId,
  name,
  phone,
  email,
  status,
  source,
  createdAt,
  latestId,
  latestStatus,
  conversationsPending,
  onToast,
}: {
  leadId: string;
  name: string;
  phone: string;
  email: string | null;
  status: string;
  source: string;
  createdAt: string;
  latestId: string | null;
  latestStatus: string | undefined;
  conversationsPending: boolean;
  onToast: (message: string) => void;
}) {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState("Overview");
  return (
    <>
      <button className="back-link" onClick={() => navigate("/leads")}><ChevronLeft size={15} />Back to leads</button>
      <Card className="lead-hero">
        <div className="lead-hero-main">
          <span className="hero-avatar">{initialsForName(name)}</span>
          <div>
            <div className="hero-name-row"><h2>{name}</h2></div>
            <p>{phone} <span>•</span> {email ?? "No email"} <span>•</span> {status}</p>
            <div className="hero-route">
              <span>Source: {source}</span>
              <span className="route-code">{leadId.slice(0, 8)}…</span>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <StartConversationButton leadId={leadId} onToast={onToast} />
          <Button icon={Pencil} variant="secondary" onClick={() => navigate(`/leads/${leadId}/edit`)}>
            Edit lead
          </Button>
        </div>
      </Card>
      <LeadDetailTabs
        leadId={leadId}
        name={name}
        phone={phone}
        email={email}
        status={status}
        source={source}
        createdAt={createdAt}
        latestId={latestId}
        latestStatus={latestStatus}
        conversationsPending={conversationsPending}
        tab={tab}
        setTab={setTab}
      />
    </>
  );
}

function LeadDetailTabs({
  leadId,
  name,
  phone,
  email,
  status,
  source,
  createdAt,
  latestId,
  latestStatus,
  conversationsPending,
  tab,
  setTab,
}: {
  leadId: string;
  name: string;
  phone: string;
  email: string | null;
  status: string;
  source: string;
  createdAt: string;
  latestId: string | null;
  latestStatus: string | undefined;
  conversationsPending: boolean;
  tab: string;
  setTab: (t: string) => void;
}) {
  const tabs = ["Overview", "Conversations", "Qualification", "Calendar", "Activity"];
  return (
    <>
      <div className="detail-tabs">{tabs.map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === "Overview" ? (
        <div className="detail-grid">
          <Card className="panel-card" data-testid="customer-panel">
            <div className="card-header"><div><span className="section-kicker">CUSTOMER</span><h2>Lead profile</h2></div></div>
            <dl className="kv-list">
              <div className="kv-row"><dt>Name</dt><dd>{name}</dd></div>
              <div className="kv-row"><dt>Phone</dt><dd>{phone}</dd></div>
              <div className="kv-row"><dt>Email</dt><dd>{email ?? NOT_PROVIDED}</dd></div>
              <div className="kv-row"><dt>Status</dt><dd>{status}</dd></div>
              <div className="kv-row"><dt>Source</dt><dd>{source}</dd></div>
              <div className="kv-row"><dt>Created</dt><dd>{new Date(createdAt).toLocaleString()}</dd></div>
            </dl>
          </Card>
          <ShipmentPanel conversationId={latestId} />
        </div>
      ) : null}
      {tab === "Conversations" ? <LeadConversationsPanel leadId={leadId} /> : null}
      {tab === "Qualification" ? (
        latestId ? (
          <QualificationPanel conversationId={latestId} />
        ) : (
          <NotAvailable what={conversationsPending ? "Loading conversations…" : "No conversation recorded for this lead yet — qualification appears after the first conversation collects enough details."} />
        )
      ) : null}
      {tab === "Calendar" ? (
        latestId && (latestStatus === "active" || latestStatus === "completed") ? (
          <MeetingPanel conversationId={latestId} schedulable={true} schedulableReason="" />
        ) : (
          <NotAvailable what="Meetings can be scheduled once this lead has an active conversation." />
        )
      ) : null}
      {tab === "Activity" ? <LeadConversationsPanel leadId={leadId} /> : null}
    </>
  );
}
