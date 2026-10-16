/**
 * Phase 14C-3 — Frontend environment configuration.
 * Phase 6 — the legacy VITE_USE_MOCK_DATA switch is removed: every
 * production page reads the backend (Phase 4 deleted the last mock data
 * source), so a "mock mode" flag can no longer change any behavior and
 * keeping it would mislead operators into thinking mock data is default.
 *
 * Single place that reads public VITE_* variables. Components and services
 * must import from here instead of reading `import.meta.env` directly or
 * hardcoding the backend URL.
 *
 * NOTE: VITE_* variables are exposed to the browser. Only public
 * configuration (API base URL) may live here. Never put
 * secrets in frontend code.
 */

export interface FrontendEnv {
  /** Base URL of the Express backend, e.g. http://localhost:4000 */
  apiBaseUrl: string;
}

function readApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  // Fall back to same-origin so relative behaviour still works if unset,
  // but local dev should set VITE_API_BASE_URL=http://localhost:4000.
  return value.length > 0 ? value : "";
}

export const frontendEnv: FrontendEnv = {
  apiBaseUrl: readApiBaseUrl(),
};
