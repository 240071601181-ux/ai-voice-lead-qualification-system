/**
 * WhatsApp API service.
 *
 * Backend routes (Express, src/routes/whatsappRoutes.ts):
 *   GET /api/v1/whatsapp/diagnostics
 *   GET /api/v1/whatsapp/deliveries?limit=
 *
 * There is deliberately NO send endpoint: sends are event-driven and
 * consent-gated server-side; the browser never sends messages.
 */

import { httpClient } from "../httpClient";
import type { WhatsappDelivery, WhatsappDiagnostics } from "../types";

export function getWhatsappDiagnostics(): Promise<WhatsappDiagnostics> {
  return httpClient.get<WhatsappDiagnostics>("/api/v1/whatsapp/diagnostics");
}

export function listWhatsappDeliveries(limit = 10): Promise<WhatsappDelivery[]> {
  return httpClient.get<WhatsappDelivery[]>("/api/v1/whatsapp/deliveries", { query: { limit } });
}
