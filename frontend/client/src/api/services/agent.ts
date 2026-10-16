/**
 * Phase 14 — Agent configuration API service (generic conversation-assistant
 * management: config, pause/resume, health).
 * Phase 20 — internal admin API: every call carries the session (refresh
 * once-and-retried via `authedRequest`).
 *
 * The retired voice custom-LLM endpoint
 * (POST /api/v1/vapi/custom-llm/chat/completions) is removed with the Vapi
 * backend; no UI action ever used it.
 */

import { authedRequest } from "../session";
import { httpClient } from "../httpClient";
import type {
  AgentConfig,
  AgentConfigPatch,
  AgentHealth,
  AgentHealthMetrics,
} from "../types";

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

/** Current operator-visible agent configuration (backend runtime store). */
export function getAgentConfig(): Promise<AgentConfig> {
  return authed((headers) => httpClient.get<AgentConfig>("/api/v1/agent/config", { headers }));
}

/** Persist editable conversation behavior / paused flag. */
export function patchAgentConfig(patch: AgentConfigPatch): Promise<AgentConfig> {
  return authed((headers) =>
    httpClient.patch<AgentConfig>("/api/v1/agent/config", patch, { headers })
  );
}

/** Pause the agent (persisted backend-side). */
export function pauseAgent(): Promise<AgentConfig> {
  return authed((headers) => httpClient.post<AgentConfig>("/api/v1/agent/pause", {}, { headers }));
}

/** Resume the agent (persisted backend-side). */
export function resumeAgent(): Promise<AgentConfig> {
  return authed((headers) => httpClient.post<AgentConfig>("/api/v1/agent/resume", {}, { headers }));
}

/** Honest agent health: real status flags; metrics are null (uncollected). */
export function getAgentHealth(): Promise<AgentHealth> {
  return authed((headers) => httpClient.get<AgentHealth>("/api/v1/agent/health", { headers }));
}

/** Real aggregate metrics (SQL counts/averages; quality is always null). */
export function getAgentHealthMetrics(): Promise<AgentHealthMetrics> {
  return authed((headers) =>
    httpClient.get<AgentHealthMetrics>("/api/v1/agent/health-metrics", { headers })
  );
}
