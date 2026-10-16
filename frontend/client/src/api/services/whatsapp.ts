/**
 * WhatsApp API service.
 * Phase 20 — internal admin API: every call carries the session (refresh
 * once-and-retried via `authedRequest`).
 *
 * Backend routes (Express, src/routes/whatsappRoutes.ts):
 *   GET /api/v1/whatsapp/diagnostics
 *   GET /api/v1/whatsapp/deliveries?limit=
 *
 * There is deliberately NO send endpoint: sends are event-driven and
 * consent-gated server-side; the browser never sends messages.
 */

import { authedRequest } from "../session";
import { httpClient } from "../httpClient";
import type { WhatsappDelivery, WhatsappDiagnostics } from "../types";

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

export function getWhatsappDiagnostics(): Promise<WhatsappDiagnostics> {
  return authed((headers) =>
    httpClient.get<WhatsappDiagnostics>("/api/v1/whatsapp/diagnostics", { headers })
  );
}

export function listWhatsappDeliveries(limit = 10): Promise<WhatsappDelivery[]> {
  return authed((headers) =>
    httpClient.get<WhatsappDelivery[]>(
      "/api/v1/whatsapp/deliveries",
      { headers, query: { limit } }
    )
  );
}
