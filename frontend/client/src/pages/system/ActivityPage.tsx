import { Activity, ArrowUpRight, CheckCircle2, Clock3, MessageCircle, Target } from "lucide-react";
import { useLocation } from "wouter";
import { Card } from "@/components/app/ui";

const items = [
  { icon: Target, color: "violet", title: "Lead qualified HOT", sub: "Arjun Rao · score 92", time: "8m" },
  { icon: MessageCircle, color: "green", title: "WhatsApp delivered", sub: "PS Pharma · template 04", time: "12m" },
  { icon: Clock3, color: "amber", title: "Follow-up scheduled", sub: "VK Industrial · tomorrow", time: "18m" },
  { icon: CheckCircle2, color: "green", title: "CRM synced", sub: "HubSpot · HS-48211", time: "24m" },
  { icon: Activity, color: "cyan", title: "Knowledge ingested", sub: "Rate card · Chennai corridor", time: "1h" },
];

/**
 * Phase 14C-12: activity stays fully mock/demo. Complete backend route audit
 * (src/app.ts + src/routes/*) confirms NO activity/audit-trail endpoint
 * exists — only /health, leads, conversations, knowledge,
 * qualifications, calendar, followups. No GET /api/v1/activity (or similar)
 * was invented. This timeline will switch once a backend endpoint lands.
 * (Phase 14: the "AI call completed" voice item retired with voice.)
 * Demo-only activity timeline in the existing visual language.
 */
export default function ActivityPage() {
  const [, navigate] = useLocation();
  return (
    <>
      <div className="page-heading">
        <div><p className="lede">A complete operational timeline, ready for review.</p></div>
      </div>
      <Card className="activity-card">
        <div className="card-header">
          <div><span className="section-kicker">AUDIT TRAIL</span><h2>All activity</h2></div>
          <span className="live-chip"><i />Live</span>
        </div>
        <div className="activity-list">
          {items.map((item) => (
            <div className="activity-item" key={item.title}>
              <span className={`activity-icon ${item.color}`}><item.icon size={14} /></span>
              <span className="activity-copy"><b>{item.title}</b><small>{item.sub}</small></span>
              <time>{item.time}</time>
            </div>
          ))}
        </div>
        <button className="activity-footer" onClick={() => navigate("/dashboard")}>Back to dashboard <ArrowUpRight size={14} /></button>
      </Card>
    </>
  );
}
