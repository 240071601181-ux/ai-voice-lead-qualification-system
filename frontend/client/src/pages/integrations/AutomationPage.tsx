import { AutomationPanel } from "./AutomationPanel";
import { useToast } from "@/layouts/AppLayout";

/**
 * n8n automation — fully wired to the real backend
 * (GET /api/v1/n8n/diagnostics, GET /api/v1/n8n/workflows). Only configured
 * workflows are shown with real delivery stats; no emit action exists
 * (emitting would fire real customer workflows). See AutomationPanel.
 */
export default function AutomationPage() {
  const { notify } = useToast();
  return <AutomationPanel onToast={notify} />;
}
