import { useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  MessageCircle,
  MessageSquareText,
  MoreHorizontal,
  Search,
  Send,
  SlidersHorizontal,
  WandSparkles,
} from "lucide-react";
import { Button, Card, TierBadge } from "@/components/app/ui";
import { useParams } from "wouter";
import type { Lead } from "@/mock/pipeline";
import { findLead } from "@/mock/details";
import { useToast } from "@/layouts/AppLayout";
import { NotFoundState } from "@/components/app/NotFoundState";
import { Skeleton } from "@/components/ui/skeleton";
import { Pencil } from "lucide-react";
import { useLeadDetail } from "@/api/hooks/useLeads";
import { useConversationsQuery, useCreateConversationMutation } from "@/api/hooks/useConversations";
import { conversationErrorCopy } from "@/components/app/conversationView";
import { getUserMessage } from "@/api/errors";

/**
 * Phase 14 — text conversations are the primary interaction surface for a
 * lead. Starts a real backend conversation (POST /api/v1/conversations)
 * and opens it. Never fakes: duplicate clicks blocked while creating.
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

export function LeadDetail({ onToast, lead, callLeadId }: { onToast: (message: string) => void; lead: Lead; callLeadId: string | null }) {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState("Overview");
  const tabs = ["Overview", "Conversations", "Qualification", "WhatsApp", "CRM", "Calendar", "Follow-ups", "Activity"];
  return <><button className="back-link" onClick={() => navigate("/leads")}><ChevronLeft size={15} />Back to leads</button><Card className="lead-hero"><div className="lead-hero-main"><span className="hero-avatar">{lead.initials}</span><div><div className="hero-name-row"><h2>{lead.name}</h2><TierBadge tier={lead.tier} /></div><p>{lead.company} <span>•</span> {lead.phone} <span>•</span> arjun@raoexports.in</p><div className="hero-route"><span><span className="route-dot pickup" />{lead.route.split(" → ")[0]}</span><ArrowUpRight size={14} /><span><span className="route-dot destination" />{lead.route.split(" → ")[1]}</span><span className="route-code">{lead.id}</span></div></div></div><div className="lead-score"><span>QUALIFICATION SCORE</span><strong>{lead.score}<small>/100</small></strong><div className="score-bar"><i style={{ width: `${lead.score}%` }} /></div></div><div className="hero-actions"><StartConversationButton leadId={callLeadId ?? null} onToast={onToast} /><button className="icon-btn surface" onClick={() => onToast("Lead edit form opened")}><SlidersHorizontal size={16} /></button><button className="icon-btn surface" onClick={() => onToast("More lead actions opened")}><MoreHorizontal size={16} /></button></div></Card><div className="detail-tabs">{tabs.map(t => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>{tab === "Overview" ? <div className="detail-grid"><Card><div className="card-header"><div><span className="section-kicker">SHIPPER PROFILE</span><h2>Lead overview</h2></div><button className="more-btn"><MoreHorizontal size={17} /></button></div><div className="detail-fields"><div><span>Pickup location</span><b>Chennai, Tamil Nadu</b></div><div><span>Destination</span><b>Mumbai, Maharashtra</b></div><div><span>Vehicle type</span><b>32 ft Multi Axle</b></div><div><span>Cargo type</span><b>Automotive components</b></div><div><span>Weight</span><b>14.2 metric tonnes</b></div><div><span>Required date</span><b>18 Sep 2026</b></div><div><span>Budget</span><b className="accent-text">₹78,000</b></div><div><span>Booking intent</span><b>Ready to book</b></div></div><div className="requirements"><span>ADDITIONAL REQUIREMENTS</span><p>Enclosed vehicle preferred. Loading window is between 06:00–09:00. Requires GPS visibility and ePOD on delivery.</p></div></Card><Card className="route-card"><div className="card-header"><div><span className="section-kicker">CORRIDOR INTELLIGENCE</span><h2>Route snapshot</h2></div><span className="confidence-chip"><CheckCircle2 size={13} />High confidence</span></div><div className="route-visual"><div className="route-line"><span className="route-point start" /><span className="route-point end" /></div><div className="route-label start-label"><b>Chennai</b><small>Pickup · 06:00–09:00</small></div><div className="route-label end-label"><b>Mumbai</b><small>Destination · 1,337 km</small></div><div className="route-hub hub-1">Hyderabad</div><div className="route-hub hub-2">Pune</div></div><div className="price-comparison"><span><small>MARKET RANGE</small><b>₹72k — ₹86k</b></span><span><small>LEAD BUDGET</small><b className="accent-text">₹78k</b></span><span><small>AI RECOMMENDATION</small><b>Accept</b></span></div></Card><Card className="timeline-card"><div className="card-header"><div><span className="section-kicker">RECENT SIGNAL</span><h2>AI qualification</h2></div><button className="link-btn" onClick={() => setTab("Qualification")}>View detail <ArrowUpRight size={14} /></button></div><div className="qualification-score-row"><div className="big-score">92<small>/100</small></div><div><TierBadge tier="HOT" /><p>Strong booking intent with clear route and budget alignment.</p></div></div><div className="factor-bars">{[["Urgency", "30", 100], ["Budget", "20", 100], ["Confirmed route", "20", 100], ["Vehicle", "10", 100], ["Cargo details", "8", 80], ["Booking intent", "4", 40]].map(([name, score, width]) => <div key={name as string}><span>{name as string}</span><div><i style={{ width: `${width}%` }} /></div><b>{score as string}</b></div>)}</div></Card><Card className="next-card"><div className="card-header"><div><span className="section-kicker">NEXT BEST ACTION</span><h2>Move this lead forward</h2></div><WandSparkles size={17} className="violet-icon" /></div><div className="next-action"><span className="next-action-icon"><MessageCircle size={18} /></span><div><b>Send call summary on WhatsApp</b><p>Lead is hot. Give Arjun a written quote and secure the booking window.</p></div><Button variant="primary" onClick={() => onToast("WhatsApp summary queued")}>Send</Button></div><div className="next-action muted-action"><span className="next-action-icon"><CalendarDays size={18} /></span><div><b>Offer a 15-minute booking review</b><p>Suggested tomorrow at 11:30 AM IST.</p></div><Button variant="ghost" onClick={() => onToast("Meeting scheduler opened")}>Schedule</Button></div></Card></div> : <TabPanel tab={tab} onToast={onToast} callLeadId={callLeadId} />}</>;
}

export function TabPanel({ tab, onToast, callLeadId }: { tab: string; onToast: (message: string) => void; callLeadId?: string | null }) {
  if (tab === "Conversations") return <LeadConversationsPanel leadId={callLeadId ?? null} />;
  if (tab === "Qualification") return <div className="detail-grid"><Card className="tab-panel"><div className="card-header"><div><span className="section-kicker">QUALIFICATION MODEL</span><h2>Signal breakdown</h2></div><TierBadge tier="HOT" /></div><div className="qualification-hero"><strong>92</strong><span>out of 100</span><p>“High-intent shipper with a confirmed corridor, realistic budget, and a firm booking window.”</p></div><div className="factor-bars wide">{[["Urgency", "30 / 30", 100], ["Budget alignment", "20 / 20", 100], ["Confirmed route", "20 / 20", 100], ["Vehicle readiness", "10 / 10", 100], ["Cargo details", "8 / 10", 80], ["Booking intent", "4 / 10", 40]].map(([name, score, width]) => <div key={name as string}><span>{name as string}</span><div><i style={{ width: `${width}%` }} /></div><b>{score as string}</b></div>)}</div></Card><Card className="explanation-card"><span className="section-kicker">MODEL EXPLANATION</span><h2>Why this lead is hot</h2><p>Arjun provided a specific route, vehicle requirement, cargo profile, and a budget within the corridor market range. The requested pickup window is less than 7 days away, indicating operational urgency.</p><div className="explanation-points"><span><CheckCircle2 size={15} />Route confirmed</span><span><CheckCircle2 size={15} />Budget in range</span><span><CheckCircle2 size={15} />Pickup under 7 days</span><span><CheckCircle2 size={15} />Decision maker engaged</span></div></Card></div>;
  const lines = tab === "WhatsApp" ? ["09:32 · AI Agent", "Hi Arjun — sharing the quote for Chennai → Mumbai. 32 ft Multi Axle, pickup 18 Sep. Estimated freight: ₹78,000.", "09:33 · Delivered", "We can hold the pickup window until 4 PM today. Reply here if you’d like us to confirm the booking."] : ["Lead created", "Lead record created", "Conversation started", "Qualification score calculated: 92 / HOT", "CRM synced", "Record pushed to HubSpot · HS-48211", "Follow-up scheduled", "WhatsApp summary queued for delivery"];
  return <Card className="tab-panel"><div className="card-header"><div><span className="section-kicker">{tab.toUpperCase()}</span><h2>{tab === "WhatsApp" ? "Message history" : `${tab} timeline`}</h2></div><Button icon={Search} variant="secondary" onClick={() => onToast("Search within this view")}>Search</Button></div><div className={tab === "Activity" ? "activity-timeline" : "message-log"}>{lines.map((line, i) => <div className="log-line" key={`${line}-${i}`}><span className="log-dot" /><div><b>{line}</b>{lines[i + 1] && i % 2 === 0 && <small>{lines[i + 1]}</small>}</div></div>)}</div></Card>;
}
export default function LeadDetailPage() {
  const { notify } = useToast();
  const params = useParams();
  const [, navigate] = useLocation();
  const id = params.id ?? "";
  const detail = useLeadDetail(id, findLead(id));

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

  const isApi = detail.source === "api";
  const apiLead = detail.apiLead;
  const callLeadId = apiLead?.id ?? detail.displayLead.id;
  return (
    <>
      <Card className="tab-panel" style={{ marginBottom: 12, padding: "10px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="section-kicker" style={{ margin: 0 }}>
            {isApi ? "LIVE BACKEND RECORD" : "DEMO DATA"}
          </span>
          <span style={{ fontSize: 10, color: "#8190a1" }}>
            {isApi
              ? `ID ${apiLead?.id} · Source ${apiLead?.source ?? "—"}${apiLead?.email ? ` · ${apiLead.email}` : ""} · Signal/score sections below are demo placeholders.`
              : `Backend lookup failed (${getUserMessage(detail.apiError)}). Showing the demo record so the UI keeps working.`}
          </span>
          <span style={{ flex: 1 }} />
          <Button icon={Pencil} variant="secondary" onClick={() => navigate(`/leads/${detail.displayLead.id}/edit`)}>
            Edit lead
          </Button>
        </div>
      </Card>
      <LeadDetail onToast={notify} lead={detail.displayLead} callLeadId={callLeadId} />
    </>
  );
}
