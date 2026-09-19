import { useMemo } from "react";
import { useLocation } from "wouter";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  Cloud,
  Database,
  Gauge,
  MessageCircle,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { AmbientShards, Button, Card, IconView, MetricCard } from "@/components/app/ui";
import { pageMeta } from "@/mock/pipeline";
import type { IconType } from "@/mock/pipeline";
import { useToast } from "@/layouts/AppLayout";
import { useQuery } from "@tanstack/react-query";
import { healthApi } from "@/api";
import { useLeadsQuery } from "@/api/hooks/useLeads";
import { useConversationsQuery } from "@/api/hooks/useConversations";
import { useQualificationsListQuery } from "@/api/hooks/useQualifications";
import { useCalendarBookingsQuery } from "@/api/hooks/useCalendar";
import { toDisplayLead } from "@/api/hooks/leadDisplay";
import { getUserMessage } from "@/api/errors";

/**
 * Phase 14C-13 — Dashboard data audit:
 * - Metric cards (Total/Hot leads, Calls today, Qualification rate): DEMO.
 *   No list/analytics endpoint exists; aggregates must not be fabricated.
 * - Pipeline velocity chart: DEMO (hardcoded SVG, no time-series endpoint).
 * - Recent leads table: LIVE via GET /api/v1/leads (page 1, limit 4 —
 *   backend returns newest first by created_at DESC). Rows show real
 *   backend fields only (name, phone/email, status); route/signal/last
 *   contact render the neutral "—" state since the backend provides no
 *   company, route, tier/score, or last-contact fields. Row click navigates
 *   to the live /leads/:id page.
 * - System pulse activity: DEMO (no activity endpoint).
 * - Runtime health card: MIXED. Per-service "Operational" rows are DEMO, but
 *   the backend reachability line below is LIVE via GET /health (liveness
 *   only — it does not verify individual services).
 * Phase 14 — legacy voice retired: "Calls today", the "Start AI call"
 * header action, the "AI call completed" pulse row, and the "Voice gateway"
 * health row are removed. The metric slot now shows the LIVE text
 * conversation total (GET /api/v1/conversations, page 1 limit 1 — only the
 * real `total` is displayed, no invented delta).
 */
function Dashboard({ onToast }: { onToast: (message: string) => void }) {
  const [, navigate] = useLocation();
  // Liveness only: proves the backend process answers, nothing more.
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => healthApi.getHealth(),
    retry: false,
    staleTime: 60_000,
  });
  // Newest leads first (backend orders by created_at DESC); only the 4 the
  // dashboard shows. Shares leadKeys ("leads") so lead creation invalidates
  // and refetches this query automatically.
  const recentLeads = useLeadsQuery({ page: 1, limit: 4 });
  // Live text-conversation total for the Conversations metric (real `total`
  // only — no invented delta/rate).
  const conversationsTotal = useConversationsQuery({ page: 1, limit: 1 });
  // Live totals for the remaining metric slots (real `total` only).
  const leadsTotal = useLeadsQuery({ page: 1, limit: 1 });
  const qualificationsTotal = useQualificationsListQuery(1, 1);
  const meetingsTotal = useCalendarBookingsQuery(1, 1);
  /** Real backend total, or a loading/unavailable placeholder (never invented). */
  const liveTotal = (q: { isPending: boolean; isError: boolean; data?: { total: number } }) =>
    q.isPending ? "…" : q.isError || q.data?.total === undefined ? "—" : String(q.data.total);
  const recentRows = useMemo(
    () => (recentLeads.data?.leads ?? []).map(toDisplayLead),
    [recentLeads.data]
  );
  const healthLine = healthQuery.isPending
    ? "Checking backend status…"
    : healthQuery.data
      ? `Backend API: ${healthQuery.data.status} · checked ${new Date(healthQuery.data.timestamp).toLocaleTimeString()}`
      : "Backend API unreachable — service statuses here are demo data.";
  return <><AmbientShards variant="dashboard" />
    <div className="page-heading"><div><p className="lede">{pageMeta["/dashboard"].description}</p></div><div className="heading-actions"><Button icon={Plus} variant="secondary" onClick={() => navigate("/leads/new")}>Create lead</Button></div></div>
    <div className="metric-grid"><MetricCard label="Total leads" value={liveTotal(leadsTotal)} delta="live total" note="from leads" icon={Users} /><MetricCard label="Qualifications" value={liveTotal(qualificationsTotal)} delta="live total" note="from qualifications" accent="violet" icon={Target} /><MetricCard label="Conversations" value={conversationsTotal.isPending ? "…" : String(conversationsTotal.data?.total ?? "—")} delta="live total" note="text conversations" accent="amber" icon={MessageSquareText} /><MetricCard label="Meetings scheduled" value={liveTotal(meetingsTotal)} delta="live total" note="from calendar bookings" accent="green" icon={Gauge} /></div>
    <div className="dashboard-grid top-charts"><Card className="chart-card large-chart"><div className="card-header"><div><span className="section-kicker">PIPELINE VELOCITY</span><h2>Lead volume over time</h2></div><div className="chart-legend"><span><i className="dot cyan" />Leads</span><span><i className="dot violet" />Qualified</span><button className="select-btn">Last 30 days <ChevronDown size={13} /></button></div></div><div className="line-chart"><div className="y-axis"><span>160</span><span>120</span><span>80</span><span>40</span><span>0</span></div><div className="chart-area"><svg viewBox="0 0 700 230" preserveAspectRatio="none"><defs><linearGradient id="fillCyan" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#00f0ff" stopOpacity=".22" /><stop offset="1" stopColor="#00f0ff" stopOpacity="0" /></linearGradient><linearGradient id="fillViolet" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#8b5cf6" stopOpacity=".18" /><stop offset="1" stopColor="#8b5cf6" stopOpacity="0" /></linearGradient></defs><path d="M0 190 C40 170 55 174 95 154 S142 128 182 143 S224 111 260 120 S307 90 348 106 S390 82 429 93 S477 52 516 75 S562 47 604 59 S654 27 700 34 V230 H0Z" fill="url(#fillCyan)" /><path d="M0 207 C45 190 64 201 102 179 S160 173 197 181 S239 145 276 159 S317 133 358 150 S400 118 438 137 S474 105 514 122 S560 88 599 109 S653 78 700 86 V230 H0Z" fill="url(#fillViolet)" /><path d="M0 190 C40 170 55 174 95 154 S142 128 182 143 S224 111 260 120 S307 90 348 106 S390 82 429 93 S477 52 516 75 S562 47 604 59 S654 27 700 34" fill="none" stroke="#00f0ff" strokeWidth="2.5" /><path d="M0 207 C45 190 64 201 102 179 S160 173 197 181 S239 145 276 159 S317 133 358 150 S400 118 438 137 S474 105 514 122 S560 88 599 109 S653 78 700 86" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="5 4" /></svg><div className="x-axis"><span>12 Aug</span><span>17 Aug</span><span>22 Aug</span><span>27 Aug</span><span>01 Sep</span><span>06 Sep</span><span>11 Sep</span></div></div></div></Card><Card className="qualification-card"><div className="card-header"><div><span className="section-kicker">LEAD SIGNAL</span><h2>Qualification mix</h2></div><button className="more-btn"><MoreHorizontal size={17} /></button></div><div className="donut-wrap"><div className="donut"><div className="donut-center"><strong>1,284</strong><span>total leads</span></div></div><div className="donut-legend"><div><span><i className="dot cyan" />Hot</span><b>186 <small>14.5%</small></b></div><div><span><i className="dot violet" />Warm</span><b>512 <small>39.9%</small></b></div><div><span><i className="dot slate" />Cold</span><b>586 <small>45.6%</small></b></div></div></div><div className="insight"><Sparkles size={14} /><span><b>Signal improving.</b> Hot lead volume is up 8.4% this week.</span></div></Card></div>
    <div className="dashboard-grid bottom-grid"><Card className="leads-card"><div className="card-header"><div><span className="section-kicker">LIVE PIPELINE</span><h2>Recent leads</h2></div><button className="link-btn" onClick={() => navigate("/leads")}>View all <ArrowUpRight size={14} /></button></div><div className="table-wrap"><table><thead><tr><th>Lead</th><th>Route</th><th>Signal</th><th>Status</th><th>Last contact</th></tr></thead><tbody>{recentLeads.isPending ? <tr><td colSpan={5}><div className="empty-state"><b>Loading recent leads…</b></div></td></tr> : recentLeads.isError ? <tr><td colSpan={5}><div className="empty-state"><b>Couldn&apos;t load recent leads</b><span>{getUserMessage(recentLeads.error)}</span><Button variant="secondary" onClick={() => { void recentLeads.refetch(); }}>Retry</Button></div></td></tr> : !recentRows.length ? <tr><td colSpan={5}><div className="empty-state"><b>No leads yet.</b><span>Create your first lead to get started.</span></div></td></tr> : recentRows.map(lead => <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}><td><div className="person-cell"><span className="person-avatar" style={{ background: `${lead.color}18`, color: lead.color }}>{lead.initials}</span><span><b>{lead.name}</b><small>{lead.company}</small></span></div></td><td>{lead.route}</td><td><span className="muted">—</span></td><td><span className="status-pill"><i />{lead.status}</span></td><td className="muted">{lead.last}</td></tr>)}</tbody></table></div></Card><Card className="activity-card"><div className="card-header"><div><span className="section-kicker">SYSTEM PULSE</span><h2>Live activity</h2></div><span className="live-chip"><i />Live</span></div><div className="activity-list">{[["Lead qualified HOT", "Arjun Rao · score 92", "8m", "violet", Target],["WhatsApp delivered", "PS Pharma · template 04", "12m", "green", MessageCircle],["Follow-up scheduled", "VK Industrial · tomorrow", "18m", "amber", Clock3]].map(([title, sub, time, color, I]) => <div className="activity-item" key={title as string}><span className={`activity-icon ${color}`}><IconView icon={I as IconType} size={14} /></span><span className="activity-copy"><b>{title as string}</b><small>{sub as string}</small></span><time>{time as string}</time></div>)}</div><button className="activity-footer" onClick={() => navigate("/activity")}>Open activity center <ArrowUpRight size={14} /></button></Card></div>
    <Card className="health-card"><div className="health-copy"><span className="section-kicker">RUNTIME HEALTH</span><h2>Everything is flowing</h2><p>Conversations, CRM, messaging, and calendar services are connected and responding normally.</p><p className="lede" style={{ marginTop: 6 }}>{healthLine}</p></div><div className="health-items"><div><span className="health-icon cyan"><Database size={15} /></span><span><b>CRM sync</b><small>Synced 2 min ago</small></span><i className="health-check"><Check size={12} /></i></div><div><span className="health-icon violet"><MessageCircle size={15} /></span><span><b>WhatsApp Cloud</b><small>Operational · 99.8%</small></span><i className="health-check"><Check size={12} /></i></div></div></Card>
  </>;
}
export default function DashboardPage() {
  const { notify } = useToast();
  return <Dashboard onToast={notify} />;
}
