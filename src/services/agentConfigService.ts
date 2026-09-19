/**
 * Agent configuration service — small runtime store for the AI Agent page.
 *
 * The static agent defaults live in `src/agent/config.ts` (system
 * prompt, languages, qualification questions, conversation rules). This
 * service layers the operator-editable conversation behavior on top
 * (greeting, qualification questions, escalation behavior, call ending)
 * plus the paused flag, in a module-level store with safe defaults.
 *
 * Persistence is process-lifetime (no new table): values survive frontend
 * refreshes and are read by the live orchestrator when assembling prompts,
 * so edits actually affect agent behavior. No secrets are stored or
 * exposed here — telephony credentials stay in backend environment only.
 */
import { agentConfig } from '../agent/config';

export const AGENT_VERSION = 'v2.4';
export const AGENT_NAME = 'MadLead Qualifier';
export const AGENT_VOICE_LABEL = 'Nova / Warm';

const DEFAULT_GREETING =
  'Welcome the customer warmly, introduce the MadLead logistics qualification, and ask how you can help.';
const DEFAULT_ESCALATION =
  'Offer a human handoff after 2 unsuccessful retries.';
const DEFAULT_CALL_ENDING =
  'Summarize confirmed details, confirm the next action, then close politely.';

const MAX_TEXT_LEN = 2000;
const MAX_QUESTIONS = 30;

export interface AgentConfig {
  name: string;
  version: string;
  paused: boolean;
  greeting: string;
  qualificationQuestions: string[];
  escalationBehavior: string;
  callEnding: string;
  /** Static backend configuration (not operator-editable). */
  languages: string[];
  /** Static backend configuration label (not operator-editable). */
  voice: string;
  maxTurns: number;
  allowCodeSwitch: boolean;
  requireConfirmation: boolean;
}

export interface AgentConfigPatch {
  greeting?: unknown;
  qualificationQuestions?: unknown;
  escalationBehavior?: unknown;
  callEnding?: unknown;
  paused?: unknown;
}

export const EDITABLE_CONFIG_KEYS = [
  'greeting',
  'qualificationQuestions',
  'escalationBehavior',
  'callEnding',
  'paused'
] as const;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const asTrimmed = (value: string): string => value.trim();

/** Accepts a string[] or a newline-separated string (splits into lines). */
const normalizeQuestions = (value: unknown): string[] | null => {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split('\n')
      : [];
  if (!Array.isArray(value) && typeof value !== 'string') return null;
  const cleaned = raw
    .filter((q): q is string => typeof q === 'string')
    .map((q) => q.trim())
    .filter((q) => q.length > 0);
  if (cleaned.length === 0 || cleaned.length > MAX_QUESTIONS) return null;
  if (cleaned.some((q) => q.length > MAX_TEXT_LEN)) return null;
  return cleaned;
};

const configError = (message: string): any => {
  const err: any = new Error(message);
  err.status = 400;
  return err;
};

const defaults = (): AgentConfig => ({
  name: AGENT_NAME,
  version: AGENT_VERSION,
  paused: false,
  greeting: DEFAULT_GREETING,
  qualificationQuestions: [...agentConfig.qualificationQuestions],
  escalationBehavior: DEFAULT_ESCALATION,
  callEnding: DEFAULT_CALL_ENDING,
  languages: [...agentConfig.languages],
  voice: AGENT_VOICE_LABEL,
  maxTurns: agentConfig.conversationRules.maxTurns,
  allowCodeSwitch: agentConfig.conversationRules.allowCodeSwitch,
  requireConfirmation: agentConfig.conversationRules.requireConfirmation
});

let store: AgentConfig = defaults();

/** Current agent configuration (defensive copy; never exposes secrets). */
export const getAgentConfig = (): AgentConfig => ({
  ...store,
  qualificationQuestions: [...store.qualificationQuestions],
  languages: [...store.languages]
});

/**
 * Prompt context assembled from the live operator configuration, so saved
 * edits actually affect the orchestrator's system prompt.
 */
export const getAgentPromptContext = (): string => {
  const cfg = store;
  return [
    `AGENT GREETING POLICY: ${cfg.greeting}`,
    `QUALIFICATION QUESTIONS (ask concisely, in order as relevant): ${cfg.qualificationQuestions.join(' | ')}`,
    `ESCALATION POLICY: ${cfg.escalationBehavior}`,
    `CALL ENDING POLICY: ${cfg.callEnding}`
  ].join('\n');
};

/** Validate + apply an operator patch. Throws 400 on invalid input. */
export const updateAgentConfig = (patch: AgentConfigPatch | undefined | null): AgentConfig => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw configError('Request body must be a JSON object');
  }
  const unknown = Object.keys(patch).filter(
    (k) => !(EDITABLE_CONFIG_KEYS as readonly string[]).includes(k)
  );
  if (unknown.length > 0) {
    throw configError(`Unknown configuration field(s): ${unknown.join(', ')}`);
  }
  if (Object.keys(patch).length === 0) {
    throw configError('No editable configuration fields provided');
  }

  const next: AgentConfig = getAgentConfig();

  if (patch.greeting !== undefined) {
    if (!isNonEmptyString(patch.greeting) || patch.greeting.trim().length > MAX_TEXT_LEN) {
      throw configError('greeting must be a non-empty string (max 2000 characters)');
    }
    next.greeting = asTrimmed(patch.greeting);
  }
  if (patch.escalationBehavior !== undefined) {
    if (!isNonEmptyString(patch.escalationBehavior) || patch.escalationBehavior.trim().length > MAX_TEXT_LEN) {
      throw configError('escalationBehavior must be a non-empty string (max 2000 characters)');
    }
    next.escalationBehavior = asTrimmed(patch.escalationBehavior);
  }
  if (patch.callEnding !== undefined) {
    if (!isNonEmptyString(patch.callEnding) || patch.callEnding.trim().length > MAX_TEXT_LEN) {
      throw configError('callEnding must be a non-empty string (max 2000 characters)');
    }
    next.callEnding = asTrimmed(patch.callEnding);
  }
  if (patch.qualificationQuestions !== undefined) {
    const questions = normalizeQuestions(patch.qualificationQuestions);
    if (!questions) {
      throw configError(
        'qualificationQuestions must be a non-empty array of strings (1-30 items, max 2000 characters each)'
      );
    }
    next.qualificationQuestions = questions;
  }
  if (patch.paused !== undefined) {
    if (typeof patch.paused !== 'boolean') {
      throw configError('paused must be a boolean');
    }
    next.paused = patch.paused;
  }

  store = next;
  return getAgentConfig();
};

export const setAgentPaused = (paused: boolean): AgentConfig => {
  store = { ...getAgentConfig(), paused };
  return getAgentConfig();
};

/** Reset to safe defaults (used in tests). */
export const resetAgentConfigForTests = (): AgentConfig => {
  store = defaults();
  return getAgentConfig();
};
