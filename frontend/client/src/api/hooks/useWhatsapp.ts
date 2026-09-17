/**
 * React Query hooks for WhatsApp backend integration.
 *
 * Backend coverage (Express, src/routes/whatsappRoutes.ts):
 *   GET /api/v1/whatsapp/diagnostics  -> useWhatsappDiagnosticsQuery
 *   GET /api/v1/whatsapp/deliveries   -> useWhatsappDeliveriesQuery
 *
 * There is deliberately NO send hook: sends are event-driven and
 * consent-gated server-side; the browser never sends messages.
 */

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../errors";
import { getWhatsappDiagnostics, listWhatsappDeliveries } from "../services/whatsapp";

export const whatsappKeys = {
  all: ["whatsapp"] as const,
  diagnostics: () => [...whatsappKeys.all, "diagnostics"] as const,
  deliveries: () => [...whatsappKeys.all, "deliveries"] as const,
};

/** Don't retry requests that will deterministically fail again. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (
    error instanceof ApiError &&
    (error.kind === "not-found" ||
      error.kind === "bad-request" ||
      error.kind === "unauthorized" ||
      error.kind === "forbidden")
  ) {
    return false;
  }
  return failureCount < 1;
}

/**
 * Real WhatsApp diagnostics. Fetched on mount so results persist in the
 * UI; "Run diagnostics" refetches explicitly.
 */
export function useWhatsappDiagnosticsQuery(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: whatsappKeys.diagnostics(),
    queryFn: () => getWhatsappDiagnostics(),
    retry: shouldRetry,
    staleTime: 0,
    enabled: opts?.enabled ?? true,
  });
}

/** Recent delivery attempts (real rows). */
export function useWhatsappDeliveriesQuery(limit = 10) {
  return useQuery({
    queryKey: [...whatsappKeys.deliveries(), limit] as const,
    queryFn: () => listWhatsappDeliveries(limit),
    retry: shouldRetry,
    staleTime: 0,
  });
}
