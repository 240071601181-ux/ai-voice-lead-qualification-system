import { BookOpen, LifeBuoy, MessageCircle, Phone } from "lucide-react";
import { Card } from "@/components/app/ui";
import { useToast } from "@/layouts/AppLayout";

/** Demo-only help center in the existing visual language. */
export default function HelpPage() {
  const { notify } = useToast();
  const cards = [
    { icon: BookOpen, color: "cyan", title: "Playbooks", sub: "Qualification flows, call scripts, and escalation paths." },
    { icon: Phone, color: "green", title: "Voice operations", sub: "Languages, latency budgets, and handoff behavior." },
    { icon: MessageCircle, color: "violet", title: "Messaging guides", sub: "Approved WhatsApp templates and consent rules." },
    { icon: LifeBuoy, color: "amber", title: "Contact support", sub: "Reach the MadLead operations team." },
  ];
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
            <div style={{ marginTop: 12 }}>
              <button className="link-btn" onClick={() => notify(`${c.title} opened`)}>Open guide</button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
