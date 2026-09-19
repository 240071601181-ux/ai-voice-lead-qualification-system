/**
 * Phase 14C-3 — Frontend environment configuration.
 *
 * Single place that reads public VITE_* variables. Components and services
 * must import from here instead of reading `import.meta.env` directly or
 * hardcoding the backend URL.
 *
 * NOTE: VITE_* variables are exposed to the browser. Only public
 * configuration (API base URL, mock switch) may live here. Never put
 * secrets in frontend code.
 */

export interface FrontendEnv {
  /** Base URL of the Express backend, e.g. http://localhost:4000 */
  apiBaseUrl: string;
  /** When true, pages keep using local mock services (default). */
  useMockData: boolean;
}

function readApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  // Fall back to same-origin so relative behaviour still works if unset,
  // but local dev should set VITE_API_BASE_URL=http://localhost:4000.
  return value.length > 0 ? value : "";
}

function readUseMockData(): boolean {
  const raw = import.meta.env.VITE_USE_MOCK_DATA as string | undefined;
  if (raw === undefined) return true;
  return raw.trim().toLowerCase() !== "false";
}

export const frontendEnv: FrontendEnv = {
  apiBaseUrl: readApiBaseUrl(),
  useMockData: readUseMockData(),
};

/** True when the UI should use mock services instead of the real backend. */
export function isMockDataEnabled(): boolean {
  return readUseMockData();
}
