import { WhatsappPanel } from "./WhatsappPanel";
import { useToast } from "@/layouts/AppLayout";

/**
 * WhatsApp integration — fully wired to the real backend
 * (GET /api/v1/whatsapp/diagnostics, GET /api/v1/whatsapp/deliveries).
 * Sends stay event-driven and consent-gated server-side; the browser never
 * sends messages. No demo counts; see WhatsappPanel.
 */
export default function WhatsappPage() {
  const { notify } = useToast();
  return <WhatsappPanel onToast={notify} />;
}
