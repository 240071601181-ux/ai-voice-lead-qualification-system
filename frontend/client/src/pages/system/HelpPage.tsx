import { BookOpen, LifeBuoy, MessageCircle, Phone } from "lucide-react";
import { Card } from "@/components/app/ui";

/**
 * Phase 4 — help topics as honest static reference.
 *
 * The previous "Open guide" buttons only fired a toast ("Playbooks opened")
 * without opening anything, so they are removed rather than kept as
 * decoration. Each card now states where the real guidance lives; nothing
 * here claims to navigate somewhere it does not.
 */
const cards = [
  { icon: BookOpen, color: "cyan", title: "Playbooks", sub: "Qualification flows, call scripts, and escalation paths.", where: "Documented in the project README and route guides." },
  { icon: Phone, color: "green", title: "Voice operations", sub: "Languages, latency budgets, and handoff behavior.", where: "Voice calling is retired; text conversations run under /conversations." },
  { icon: MessageCircle, color: "violet", title: "Messaging guides", sub: "Approved WhatsApp templates and consent rules.", where: "Templates and consent mode are shown on the WhatsApp page diagnostics." },
  { icon: LifeBuoy, color: "amber", title: "Contact support", sub: "Reach the MadLead operations team.", where: "Use your workspace support channel for help with this deployment." },
];

export default function HelpPage() {
  return (
    <>
      <div className="page-heading">
        <div><p className="lede">Guides and support for your operations team.</p></div>
      </div>
      <div className="metric-grid">
        {cards.map((c) => (
          <Card key={c.title} className="metric-card">
            <div className="metric-top">
              <span className="metric-label">{c.title}</span>
              <span className={`metric-icon metric-${c.color}`}><c.icon size={16} /></span>
            </div>
            <span className="metric-note">{c.sub}</span>
            <span className="metric-note" style={{ marginTop: 8, opacity: 0.75 }}>{c.where}</span>
          </Card>
        ))}
      </div>
    </>
  );
}
