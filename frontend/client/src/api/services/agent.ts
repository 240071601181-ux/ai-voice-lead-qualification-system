/**
 * Phase 14 — Agent configuration API service (generic conversation-assistant
 * management: config, pause/resume, health).
 *
 * The retired voice custom-LLM endpoint
 * (POST /api/v1/vapi/custom-llm/chat/completions) is removed with the Vapi
 * backend; no UI action ever used it.
 */

import { httpClient } from "../httpClient";
import type {
  AgentConfig,
  AgentConfigPatch,
  AgentHealth,
  AgentHealthMetrics,
} from "../types";

/** Current operator-visible agent configuration (backend runtime store). */
export function getAgentConfig(): Promise<AgentConfig> {
  return httpClient.get<AgentConfig>("/api/v1/agent/config");
}

/** Persist editable conversation behavior / paused flag. */
export function patchAgentConfig(patch: AgentConfigPatch): Promise<AgentConfig> {
  return httpClient.patch<AgentConfig>("/api/v1/agent/config", patch);
}

/** Pause the agent (persisted backend-side). */
export function pauseAgent(): Promise<AgentConfig> {
  return httpClient.post<AgentConfig>("/api/v1/agent/pause");
}

/** Resume the agent (persisted backend-side). */
export function resumeAgent(): Promise<AgentConfig> {
  return httpClient.post<AgentConfig>("/api/v1/agent/resume");
}

/** Honest agent health: real status flags; metrics are null (uncollected). */
export function getAgentHealth(): Promise<AgentHealth> {
  return httpClient.get<AgentHealth>("/api/v1/agent/health");
}

/** Real aggregate metrics (SQL counts/averages; quality is always null). */
export function getAgentHealthMetrics(): Promise<AgentHealthMetrics> {
  return httpClient.get<AgentHealthMetrics>("/api/v1/agent/health-metrics");
}
