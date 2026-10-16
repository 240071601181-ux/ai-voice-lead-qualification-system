import { useMemo } from "react";
import { useLocation } from "wouter";
import {
  ArrowUpRight,
  CalendarDays,
  Clock3,
  Database,
  Gauge,
  MessageCircle,
  MessageSquareText,
  Network,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { AmbientShards, Button, Card, IconView, MetricCard } from "@/components/app/ui";
import { pageMeta } from "@/mock/pipeline";
import type { IconType } from "@/mock/pipeline";
import { useQuery } from "@tanstack/react-query";
import { healthApi } from "@/api";
import { useLeadsQuery } from "@/api/hooks/useLeads";
import { useFollowupsQuery } from "@/api/hooks/useFollowups";
import { useQualificationMixQuery, useQualificationsListQuery } from "@/api/hooks/useQualifications";
import { useCalendarBookingsQuery, useCalendarDiagnosticsQuery } from "@/api/hooks/useCalendar";
import { useCrmDiagnosticsQuery } from "@/api/hooks/useCrm";
import { useWhatsappDiagnosticsQuery } from "@/api/hooks/useWhatsapp";
import { useN8nDiagnosticsQuery } from "@/api/hooks/useN8n";
import { useDashboardSummaryQuery } from "@/api/hooks/useDashboard";
import { toDisplayLead } from "@/api/hooks/leadDisplay";
import { getUserMessage } from "@/api/errors";
import type { IntegrationDiagnosticsOverall } from "@/api/types";

/**
 * Phase 4 — Dashboard on real backend data only.
 * - Metric cards + work queue: LIVE via GET /api/v1/dashboard/summary
 *   (bounded SQL counts; conversations scoped to the requesting user).
 *   A failed summary request renders "—" (never a zero) with retry.
 * - Qualification mix donut: LIVE via GET /api/v1/dashboard/qualification-mix.
 * - Recent leads: LIVE via GET /api/v1/leads (page 1, limit 4, newest first).
 * - Recent activity: LIVE records only (latest qualifications, follow-ups,
 *   and calendar bookings merged by creation time). No historical trend is
 *   fabricated: the backend exposes current totals, not a time series, so
 *   the old hardcoded velocity chart is replaced by an honest work queue.
 * - Integration status: LIVE reachability (GET /health) plus per-provider
 *   diagnostics (CRM / WhatsApp / Calendar / n8n). A provider shows
 *   "Verified" only when its diagnostics report ok; otherwise the real
 *   state (not configured / needs attention / unavailable) is shown.
 * Phase 14 — legacy voice retired: no calls/voice rows anywhere.
 */

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function diagnosticsLabel(
  query: { isPending: boolean; isError: boolean; data?: { status: IntegrationDiagnosticsOverall } },
): { text: string; tone: "green" | "amber" | "slate" } {
  if (query.isPending) return { text: "Checking…", tone: "slate" };
  if (query.isError || !query.data) return { text: "Unavailable", tone: "amber" };
  if (query.data.status === "ok") return { text: "Verified", tone: "green" };
  if (query.data.status === "not_configured") return { text: "Not configured", tone: "slate" };
  return { text: "Needs attention", tone: "amber" };
}

const rowButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: 0,
  width: "100%",
  textAlign: "left",
  cursor: "pointer",
  color: "inherit",
  font: "inherit",
  paddingLeft: 0,
  paddingRight: 0,
};

const FOLLOWUP_ACTION_LABELS: Record<string, string> = {
  whatsapp_followup: "WhatsApp follow-up",
  crm_followup: "CRM follow-up",
  missed_reminder: "Missed-call reminder",
};

function Dashboard() {
  const [, navigate] = useLocation();
  // Liveness only: proves the backend process answers, nothing more.
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => healthApi.getHealth(),
    retry: false,
    staleTime: 60_000,
  });
  // Single aggregate source for every headline number (bounded SQL counts).
  const summary = useDashboardSummaryQuery();
  const totals = summary.data;
  // Live qualification mix for the donut (SQL tier counts, never rows).
  const qualMix = useQualificationMixQuery();
  const mix = qualMix.data;
  const mixTotal = mix?.total ?? 0;
  const mixPct = (n: number) => (mixTotal > 0 ? `${Math.round((n / mixTotal) * 1000) / 10}%` : "—");
  const mixShare = (n: number) => (mixTotal > 0 ? (n / mixTotal) * 100 : 0);
  const donutBackground = mix
    ? `conic-gradient(var(--cyan) 0 ${mixShare(mix.hot)}%, var(--violet) ${mixShare(mix.hot)}% ${mixShare(mix.hot) + mixShare(mix.warm)}%, #415064 ${mixShare(mix.hot) + mixShare(mix.warm)}% 100%)`
    : undefined;
  /** Real backend total, or a loading/unavailable placeholder (never invented). */
  const liveCount = (value: number | undefined) =>
    summary.isPending ? "…" : summary.isError || value === undefined ? "—" : String(value);
  // Newest leads first (backend orders by created_at DESC); only the 4 the
  // dashboard shows. Shares leadKeys ("leads") so lead creation invalidates
  // and refetches this query automatically.
  const recentLeads = useLeadsQuery({ page: 1, limit: 4 });
  const recentRows = useMemo(
    () => (recentLeads.data?.leads ?? []).map(toDisplayLead),
    [recentLeads.data]
  );
  // Recent operational records for the activity feed (small bounded pages).
  const recentQualifications = useQualificationsListQuery(1, 3);
  const recentFollowups = useFollowupsQuery({ page: 1, limit: 3 });
  const recentBookings = useCalendarBookingsQuery(1, 3);
  const activityPending =
    recentQualifications.isPending || recentFollowups.isPending || recentBookings.isPending;
  const activityError =
    recentQualifications.error ?? recentFollowups.error ?? recentBookings.error ?? null;
  const activityItems = useMemo(() => {
    type Item = {
      key: string;
      icon: IconType;
      color: string;
      title: string;
      sub: string;
      at: string | null;
      path: string;
    };
    const items: Item[] = [];
    for (const q of recentQualifications.data?.qualifications ?? []) {
      items.push({
        key: `qual-${q.id}`,
        icon: Target,
        color: "violet",
        title: `Lead scored ${q.tier}`,
        sub: `Score ${q.score} · qualified ${formatWhen(q.qualified_at)}`,
        at: q.created_at,
        path: `/qualifications/${q.id}`,
      });
    }
    for (const f of recentFollowups.data?.followups ?? []) {
      items.push({
        key: `followup-${f.id}`,
        icon: Clock3,
        color: "amber",
        title: `Follow-up ${f.status}`,
        sub: `${FOLLOWUP_ACTION_LABELS[f.action] ?? f.action} · due ${formatWhen(f.scheduled_at)}`,
        at: f.created_at,
        path: `/followups/${f.id}`,
      });
    }
    for (const b of recentBookings.data?.bookings ?? []) {
      items.push({
        key: `booking-${b.id}`,
        icon: CalendarDays,
        color: "cyan",
        title: `Meeting ${b.status}`,
        sub: formatWhen(b.scheduled_start),
        at: b.created_at,
        path: `/calendar/${b.id}`,
      });
    }
    return items
      .sort((a, b) => {
        const ta = a.at ? new Date(a.at).getTime() : 0;
        const tb = b.at ? new Date(b.at).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 5);
  }, [recentQualifications.data, recentFollowups.data, recentBookings.data]);
  const refreshActivity = () => {
    void recentQualifications.refetch();
    void recentFollowups.refetch();
    void recentBookings.refetch();
  };
  // Per-provider diagnostics: "Verified" only on a real ok report.
  const crmDiag = useCrmDiagnosticsQuery();
  const whatsappDiag = useWhatsappDiagnosticsQuery();
  const calendarDiag = useCalendarDiagnosticsQuery();
  const n8nDiag = useN8nDiagnosticsQuery();
  const healthLine = healthQuery.isPending
    ? "Checking backend status…"
    : healthQuery.data
      ? `Backend API: ${healthQuery.data.status} · checked ${new Date(healthQuery.data.timestamp).toLocaleTimeString()}`
      : "Backend API unreachable — integration states below are unavailable.";
  const integrations: { name: string; detail: string; icon: IconType; state: ReturnType<typeof diagnosticsLabel> }[] = [
    { name: "CRM sync", detail: "Provider sync history", icon: Database, state: diagnosticsLabel(crmDiag) },
    { name: "WhatsApp", detail: "Template delivery history", icon: MessageCircle, state: diagnosticsLabel(whatsappDiag) },
    { name: "Calendar", detail: "Booking provider checks", icon: CalendarDays, state: diagnosticsLabel(calendarDiag) },
    { name: "Automation", detail: "Optional n8n workflows", icon: Network, state: diagnosticsLabel(n8nDiag) },
  ];
  const pendingFollowups =
    (totals?.followups.pending ?? 0) + (totals?.followups.processing ?? 0);
  return <><AmbientShards variant="dashboard" />
    <div className="page-heading"><div><p className="lede">{pageMeta["/dashboard"].description}</p></div><div className="heading-actions"><Button icon={Plus} variant="secondary" onClick={() => navigate("/leads/new")}>Create lead</Button></div></div>
    {summary.isError && <Card className="tab-panel" style={{ marginBottom: 12 }}><div className="empty-state"><b>Couldn&apos;t load dashboard totals</b><span>{getUserMessage(summary.error)}</span><Button variant="secondary" onClick={() => { void summary.refetch(); }}>Retry</Button></div></Card>}
    <div className="metric-grid"><MetricCard label="Total leads" value={liveCount(totals?.leads.total)} delta="live total" note="all leads" icon={Users} /><MetricCard label="Qualifications" value={liveCount(totals?.qualifications.total)} delta="live total" note="scored HOT / WARM / COLD" accent="violet" icon={Target} /><MetricCard label="My conversations" value={liveCount(totals?.conversations.total)} delta="live total" note="owned text conversations" accent="amber" icon={MessageSquareText} /><MetricCard label="Upcoming meetings" value={liveCount(totals?.bookings.upcoming)} delta="live total" note="future booked slots" accent="green" icon={Gauge} /></div>
    <div className="dashboard-grid top-charts"><Card className="chart-card large-chart"><div className="card-header"><div><span className="section-kicker">WORK QUEUE</span><h2>What needs attention</h2></div><button className="link-btn" onClick={() => navigate("/followups")}>Open follow-ups <ArrowUpRight size={14} /></button></div>{summary.isPending ? <div className="empty-state"><b>Loading work queue…</b></div> : summary.isError || !totals ? <div className="empty-state"><b>Couldn&apos;t load the work queue</b><span>{getUserMessage(summary.error)}</span><Button variant="secondary" onClick={() => { void summary.refetch(); }}>Retry</Button></div> : <><div className="activity-list"><button className="activity-item" style={rowButtonStyle} onClick={() => navigate("/followups")}><span className="activity-icon amber"><Clock3 size={14} /></span><span className="activity-copy"><b>{pendingFollowups} follow-up{pendingFollowups === 1 ? "" : "s"} pending</b><small>Scheduled or processing actions</small></span><ArrowUpRight size={14} /></button><button className="activity-item" style={rowButtonStyle} onClick={() => navigate("/followups")}><span className="activity-icon violet"><Target size={14} /></span><span className="activity-copy"><b>{totals.followups.failed} follow-up{totals.followups.failed === 1 ? "" : "s"} failed</b><small>Eligible for retry</small></span><ArrowUpRight size={14} /></button><button className="activity-item" style={rowButtonStyle} onClick={() => navigate("/calendar")}><span className="activity-icon cyan"><CalendarDays size={14} /></span><span className="activity-copy"><b>{totals.bookings.upcoming} upcoming meeting{totals.bookings.upcoming === 1 ? "" : "s"}</b><small>Of {totals.bookings.total} persisted bookings</small></span><ArrowUpRight size={14} /></button><button className="activity-item" style={rowButtonStyle} onClick={() => navigate("/conversations")}><span className="activity-icon green"><MessageSquareText size={14} /></span><span className="activity-copy"><b>{totals.conversations.active} active conversation{totals.conversations.active === 1 ? "" : "s"}</b><small>{totals.conversations.completed} completed · {totals.conversations.abandoned} abandoned</small></span><ArrowUpRight size={14} /></button></div><div className="insight"><Sparkles size={14} /><span>Current totals from the backend — no historical trend is tracked yet.</span></div></>}</Card><Card className="qualification-card"><div className="card-header"><div><span className="section-kicker">LEAD SIGNAL</span><h2>Qualification mix</h2></div></div>{qualMix.isPending ? (<div className="empty-state"><b>Loading qualification mix…</b></div>) : qualMix.isError || !mix ? (<div className="empty-state"><b>Couldn&apos;t load qualification mix</b><span>{getUserMessage(qualMix.error)}</span><Button variant="secondary" onClick={() => { void qualMix.refetch(); }}>Retry</Button></div>) : mixTotal === 0 ? (<div className="empty-state"><b>No qualification data yet.</b><span>Complete conversations to build the qualification mix.</span></div>) : (<><div className="donut-wrap"><div className="donut" style={donutBackground ? { background: donutBackground } : undefined}><div className="donut-center"><strong>{mixTotal}</strong><span>qualifications</span></div></div><div className="donut-legend"><div><span><i className="dot cyan" />Hot</span><b>{mix.hot} <small>{mixPct(mix.hot)}</small></b></div><div><span><i className="dot violet" />Warm</span><b>{mix.warm} <small>{mixPct(mix.warm)}</small></b></div><div><span><i className="dot slate" />Cold</span><b>{mix.cold} <small>{mixPct(mix.cold)}</small></b></div></div></div><div className="insight"><Sparkles size={14} /><span>Live mix of {mixTotal} qualification record{mixTotal === 1 ? "" : "s"}.</span></div></>)}</Card></div>
    <div className="dashboard-grid bottom-grid"><Card className="leads-card"><div className="card-header"><div><span className="section-kicker">LIVE PIPELINE</span><h2>Recent leads</h2></div><button className="link-btn" onClick={() => navigate("/leads")}>View all <ArrowUpRight size={14} /></button></div><div className="table-wrap"><table><thead><tr><th>Lead</th><th>Route</th><th>Signal</th><th>Status</th><th>Last contact</th></tr></thead><tbody>{recentLeads.isPending ? <tr><td colSpan={5}><div className="empty-state"><b>Loading recent leads…</b></div></td></tr> : recentLeads.isError ? <tr><td colSpan={5}><div className="empty-state"><b>Couldn&apos;t load recent leads</b><span>{getUserMessage(recentLeads.error)}</span><Button variant="secondary" onClick={() => { void recentLeads.refetch(); }}>Retry</Button></div></td></tr> : !recentRows.length ? <tr><td colSpan={5}><div className="empty-state"><b>No leads yet.</b><span>Create your first lead to get started.</span></div></td></tr> : recentRows.map(lead => <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}><td><div className="person-cell"><span className="person-avatar" style={{ background: `${lead.color}18`, color: lead.color }}>{lead.initials}</span><span><b>{lead.name}</b><small>{lead.company}</small></span></div></td><td>{lead.route}</td><td><span className="muted">—</span></td><td><span className="status-pill"><i />{lead.status}</span></td><td className="muted">{lead.last}</td></tr>)}</tbody></table></div></Card><Card className="activity-card"><div className="card-header"><div><span className="section-kicker">SYSTEM PULSE</span><h2>Recent activity</h2></div><button className="link-btn" onClick={refreshActivity} aria-label="Refresh activity"><RefreshCw size={14} /> Refresh</button></div>{activityPending ? <div className="empty-state"><b>Loading recent activity…</b></div> : activityError ? <div className="empty-state"><b>Couldn&apos;t load recent activity</b><span>{getUserMessage(activityError)}</span><Button variant="secondary" onClick={refreshActivity}>Retry</Button></div> : !activityItems.length ? <div className="empty-state"><b>No activity yet.</b><span>Qualifications, follow-ups, and meetings will appear here.</span></div> : <div className="activity-list">{activityItems.map((item) => <button className="activity-item" style={rowButtonStyle} key={item.key} onClick={() => navigate(item.path)}><span className={`activity-icon ${item.color}`}><IconView icon={item.icon} size={14} /></span><span className="activity-copy"><b>{item.title}</b><small>{item.sub}</small></span><time>{relativeTime(item.at)}</time></button>)}</div>}<button className="activity-footer" onClick={() => navigate("/activity")}>Open activity center <ArrowUpRight size={14} /></button></Card></div>
    <Card className="health-card"><div className="health-copy"><span className="section-kicker">RUNTIME HEALTH</span><h2>Integration status</h2><p className="lede" style={{ marginTop: 6 }}>{healthLine}</p></div><div className="health-items">{integrations.map((row) => <div key={row.name}><span className="health-icon cyan"><row.icon size={15} /></span><span><b>{row.name}</b><small>{row.detail}</small></span><span className="connected-chip">{row.state.text}</span></div>)}</div></Card>
  </>;
}
export default function DashboardPage() {
  return <Dashboard />;
}
