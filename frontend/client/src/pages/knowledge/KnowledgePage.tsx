import { KnowledgeIntegrationPanel } from "../integrations/KnowledgeIntegrationPanel";
import { useToast } from "@/layouts/AppLayout";

/**
 * Knowledge base overview — fully wired to the real backend
 * (GET /api/v1/knowledge/documents + /documents/:id + /diagnostics, plus
 * the live /knowledge/ingest and /knowledge/search flows). No demo
 * documents or hardcoded aggregates; see KnowledgeIntegrationPanel.
 */
export default function KnowledgePage() {
  const { notify } = useToast();
  return <KnowledgeIntegrationPanel onToast={notify} />;
}
