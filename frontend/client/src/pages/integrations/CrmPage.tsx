import { CrmPanel } from "./CrmPanel";
import { useToast } from "@/layouts/AppLayout";

/**
 * CRM integration — fully wired to the real backend
 * (GET /api/v1/crm/diagnostics, POST /api/v1/crm/sync, GET /api/v1/crm/syncs).
 * No demo records or hardcoded aggregates; see CrmPanel.
 */
export default function CrmPage() {
  const { notify } = useToast();
  return <CrmPanel onToast={notify} />;
}
