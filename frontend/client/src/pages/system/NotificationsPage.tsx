import { BellOff } from "lucide-react";
import { Card } from "@/components/app/ui";

/**
 * Phase 4 — notifications honestly unavailable.
 *
 * A complete backend route audit confirms there is NO notification model,
 * persistence, or endpoint (no GET /api/v1/notifications or similar), and
 * none is invented here. The previous demo list (Arjun Rao / score 92 /
 * "3 unread") and its local-only "mark all as read" have been removed so
 * the interface never presents mock data as backend records or a fake
 * unread count.
 *
 * What a real implementation needs: a notifications table (user-scoped),
 * list + mark-read endpoints behind requireAuth, and unread-count derivation
 * from persisted rows — then this page can render them with loading, empty,
 * error, and retry states like the rest of the app.
 */
export default function NotificationsPage() {
  return (
    <>
      <div className="page-heading">
        <div><p className="lede">Operational alerts that need your attention.</p></div>
      </div>
      <Card className="activity-card">
        <div className="card-header">
          <div><span className="section-kicker">SIGNALS</span><h2>Notifications</h2></div>
        </div>
        <div className="empty-state">
          <BellOff size={22} />
          <b>Notifications aren&apos;t available yet.</b>
          <span>This workspace has no notification store, so there is nothing to list and no unread count to show. Operational signal remains available on the Dashboard, Activity, and Follow-ups pages.</span>
        </div>
      </Card>
    </>
  );
}
