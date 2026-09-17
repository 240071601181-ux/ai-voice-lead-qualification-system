import { OperationsPage } from "../operations/OperationsPage";
import { useToast } from "@/layouts/AppLayout";
import { Card } from "@/components/app/ui";

/**
 * Phase 14C-6: the calls list stays on mock/demo rows. The backend exposes
 * call lifecycle only through Vapi webhooks (POST) — there is deliberately
 * no GET-all-calls or GET-call-by-id endpoint, so no list/detail call query
 * exists. Call-associated qualification/lead data resolves through those
 * real endpoints on the detail page where a genuine backend callId is used.
 * This list will switch once a backend call endpoint lands. OperationsPage
 * is shared with Qualifications/Follow-ups and is intentionally untouched.
 *
 * Phase 10: the rows and headline metrics below are illustrative demo data
 * (no call-list API exists) — labelled as such instead of presented as
 * operational fact. Text conversations live under /conversations (real API).
 */
export default function CallsPage() {
  const { notify } = useToast();
  return (
    <>
      <Card className="table-card" style={{ marginBottom: 12, padding: "10px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="section-kicker" style={{ margin: 0 }}>DEMO DATA</span>
          <span style={{ fontSize: 12, color: "#8190a1" }}>
            Call rows and headline metrics are illustrative — the backend has no call-list
            endpoint yet. Live text conversations are under Conversations.
          </span>
        </div>
      </Card>
      <OperationsPage type="/calls" onToast={notify} />
    </>
  );
}
