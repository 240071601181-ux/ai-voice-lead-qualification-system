import { useMemo } from "react";
import { Activity, ArrowUpRight, CalendarDays, CheckCircle2, Clock3, MessageCircle, Target, XCircle } from "lucide-react";
import { useLocation } from "wouter";
import { Button, Card, IconView } from "@/components/app/ui";
import type { IconType } from "@/mock/pipeline";
import { useCrmSyncsQuery } from "@/api/hooks/useCrm";
import { useWhatsappDeliveriesQuery } from "@/api/hooks/useWhatsapp";
import { useFollowupsQuery } from "@/api/hooks/useFollowups";
import { useCalendarBookingsQuery } from "@/api/hooks/useCalendar";
import { useQualificationsListQuery } from "@/api/hooks/useQualifications";
import { getUserMessage } from "@/api/errors";

/**
 * Phase 4 — activity from real persisted records.
 *
 * There is no dedicated activity/audit-trail endpoint, and none is
 * invented. This timeline is honestly composed from the latest backend
 * rows that already exist: CRM sync attempts, WhatsApp deliveries,
 * follow-up records, calendar bookings, and qualification records
 * (bounded pages, merged by creation time). Every entry links to its
 * real record. No past user action is manufactured: an empty backend
 * renders an honest empty state, and a failed source renders an error
 * with retry — never a fabricated zero or a fake "Live" feed.
 */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

interface ActivityItem {
  key: string;
  icon: IconType;
  color: string;
  title: string;
  sub: string;
  at: string | null;
  path: string;
}

const FOLLOWUP_ACTION_LABELS: Record<string, string> = {
  whatsapp_followup: "WhatsApp follow-up",
  crm_followup: "CRM follow-up",
  missed_reminder: "Missed-call reminder",
};

export default function ActivityPage() {
  const [, navigate] = useLocation();
  const crmSyncs = useCrmSyncsQuery(5);
  const whatsappDeliveries = useWhatsappDeliveriesQuery(5);
  const followups = useFollowupsQuery({ page: 1, limit: 5 });
  const bookings = useCalendarBookingsQuery(1, 5);
  const qualifications = useQualificationsListQuery(1, 5);

  const isPending =
    crmSyncs.isPending ||
    whatsappDeliveries.isPending ||
    followups.isPending ||
    bookings.isPending ||
    qualifications.isPending;

  const errors = [
    crmSyncs.error,
    whatsappDeliveries.error,
    followups.error,
    bookings.error,
    qualifications.error,
  ].filter((e): e is Error => e instanceof Error);

  const items = useMemo<ActivityItem[]>(() => {
    const rows: ActivityItem[] = [];
    for (const s of crmSyncs.data ?? []) {
      const ok = s.status === "success" || s.status === "synced" || s.status === "completed";
      rows.push({
        key: `crm-${s.id}`,
        icon: ok ? CheckCircle2 : XCircle,
        color: ok ? "green" : "amber",
        title: `CRM sync ${s.status}`,
        sub: `${s.provider}${s.lead_id ? ` · lead ${s.lead_id.slice(0, 8)}` : ""}`,
        at: s.updated_at ?? s.created_at,
        path: "/crm",
      });
    }
    for (const d of whatsappDeliveries.data ?? []) {
      const ok = d.status === "delivered" || d.status === "sent" || d.status === "success";
      rows.push({
        key: `wa-${d.id}`,
        icon: MessageCircle,
        color: ok ? "green" : "amber",
        title: `WhatsApp ${d.status}`,
        sub: `${d.template}${d.lead_id ? ` · lead ${d.lead_id.slice(0, 8)}` : ""}`,
        at: d.updated_at ?? d.created_at,
        path: "/whatsapp",
      });
    }
    for (const f of followups.data?.followups ?? []) {
      rows.push({
        key: `fu-${f.id}`,
        icon: Clock3,
        color: "amber",
        title: `Follow-up ${f.status}`,
        sub: FOLLOWUP_ACTION_LABELS[f.action] ?? f.action,
        at: f.updated_at ?? f.created_at,
        path: `/followups/${f.id}`,
      });
    }
    for (const b of bookings.data?.bookings ?? []) {
      rows.push({
        key: `bk-${b.id}`,
        icon: CalendarDays,
        color: "cyan",
        title: `Meeting ${b.status}`,
        sub: b.scheduled_start ? new Date(b.scheduled_start).toLocaleString() : "Unscheduled draft",
        at: b.updated_at ?? b.created_at,
        path: `/calendar/${b.id}`,
      });
    }
    for (const q of qualifications.data?.qualifications ?? []) {
      rows.push({
        key: `q-${q.id}`,
        icon: Target,
        color: "violet",
        title: `Lead scored ${q.tier}`,
        sub: `Score ${q.score}`,
        at: q.qualified_at ?? q.created_at,
        path: `/qualifications/${q.id}`,
      });
    }
    return rows
      .sort((a, b) => {
        const ta = a.at ? new Date(a.at).getTime() : 0;
        const tb = b.at ? new Date(b.at).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 15);
  }, [crmSyncs.data, whatsappDeliveries.data, followups.data, bookings.data, qualifications.data]);

  const refetchAll = () => {
    void crmSyncs.refetch();
    void whatsappDeliveries.refetch();
    void followups.refetch();
    void bookings.refetch();
    void qualifications.refetch();
  };

  return (
    <>
      <div className="page-heading">
        <div><p className="lede">Latest persisted operations across syncs, deliveries, follow-ups, meetings, and qualifications.</p></div>
        <div className="heading-actions"><Button variant="secondary" onClick={refetchAll}>Refresh</Button></div>
      </div>
      <Card className="activity-card">
        <div className="card-header">
          <div><span className="section-kicker">AUDIT TRAIL</span><h2>All activity</h2></div>
        </div>
        {isPending ? (
          <div className="empty-state"><b>Loading activity…</b></div>
        ) : items.length === 0 && errors.length > 0 ? (
          <div className="empty-state">
            <b>Couldn&apos;t load activity</b>
            <span>{getUserMessage(errors[0])}</span>
            <Button variant="secondary" onClick={refetchAll}>Retry</Button>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <Activity size={22} />
            <b>No activity yet.</b>
            <span>Syncs, deliveries, follow-ups, meetings, and qualifications will appear here once they exist.</span>
          </div>
        ) : (
          <>
            {errors.length > 0 && (
              <div className="empty-state">
                <b>Some sources are unavailable</b>
                <span>{getUserMessage(errors[0])} — showing records that did load.</span>
                <Button variant="secondary" onClick={refetchAll}>Retry</Button>
              </div>
            )}
            <div className="activity-list">
              {items.map((item) => (
                <button
                  key={item.key}
                  className="activity-item"
                  style={{ background: "transparent", border: 0, width: "100%", textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit", paddingLeft: 0, paddingRight: 0 }}
                  onClick={() => navigate(item.path)}
                >
                  <span className={`activity-icon ${item.color}`}><IconView icon={item.icon} size={14} /></span>
                  <span className="activity-copy"><b>{item.title}</b><small>{item.sub}</small></span>
                  <time>{relativeTime(item.at)}</time>
                </button>
              ))}
            </div>
          </>
        )}
        <button className="activity-footer" onClick={() => navigate("/dashboard")}>Back to dashboard <ArrowUpRight size={14} /></button>
      </Card>
    </>
  );
}
