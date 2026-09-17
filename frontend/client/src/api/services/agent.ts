/**
 * Phase 14C-10 — Agent custom-LLM API service.
 *
 * Backend endpoint (existing Express backend, DO NOT MODIFY):
 *   POST /api/v1/vapi/custom-llm/chat/completions   (non-streaming JSON only)
 *
 * This drives the backend agent orchestrator (system prompt + selective RAG
 * stay backend-side). Sends ONLY supported fields: `messages` (required) and
 * optional `model`/`tools`. No call context is sent, so turns are stateless
 * (no conversation state read/written). Streaming (SSE) is unsupported here.
 *
 * IMPORTANT: no UI action uses this service yet. AiAgentPage has no test/chat
 * action, and adding a playground would be new UI against the live voice
 * orchestrator — out of scope for this phase. This service exists so a future
 * playground can connect without inventing contracts.
 *
 * NOTE: responses use the OpenAI shape, not the { success, data } envelope;
 * the shared httpClient passes non-envelope JSON through verbatim.
 */

import { httpClient } from "../httpClient";
import type {
  AgentChatCompletionInput,
  AgentChatCompletionResult,
  AgentConfig,
  AgentConfigPatch,
  AgentHealth,
} from "../types";

export function postAgentChatCompletion(
  data: AgentChatCompletionInput
): Promise<AgentChatCompletionResult> {
  return httpClient.post<AgentChatCompletionResult>(
    "/api/v1/vapi/custom-llm/chat/completions",
    data
  );
}

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

/** First assistant message text, or empty string when the backend returns none. */
export function getAssistantContent(result: AgentChatCompletionResult): string {
  return result.choices?.[0]?.message?.content ?? "";
}
