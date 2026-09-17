/**
 * Workspace settings service — validation + safe defaults.
 *
 * Single workspace record (no auth/workspace systems invented): the Settings
 * page reads one row and patches editable fields. All fields are validated
 * server-side; unknown fields and empty patches are rejected. Nothing here
 * stores or returns secrets (display preferences + boolean flags only).
 */
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
  WorkspaceSettingsPatch,
  WorkspaceSettingsRow
} from '../repositories/settingsRepository';

export const EDITABLE_SETTING_KEYS = [
  'workspace_name',
  'timezone',
  'default_language',
  'lead_score_threshold',
  'notify_hot_lead',
  'notify_integration_failure',
  'notify_followup_due',
  'notify_daily_digest'
] as const;

export const SETTING_LANGUAGES = ['English', 'Hindi', 'Tamil'] as const;

const badRequest = (message: string): any => {
  const err: any = new Error(message);
  err.status = 400;
  return err;
};

const isValidTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export const getSettings = async (): Promise<WorkspaceSettingsRow> => {
  return getWorkspaceSettings();
};

export interface SettingsPatchInput {
  workspace_name?: unknown;
  timezone?: unknown;
  default_language?: unknown;
  lead_score_threshold?: unknown;
  notify_hot_lead?: unknown;
  notify_integration_failure?: unknown;
  notify_followup_due?: unknown;
  notify_daily_digest?: unknown;
}

const assertBoolean = (key: string, value: unknown): boolean => {
  if (typeof value !== 'boolean') {
    throw badRequest(`${key} must be a boolean`);
  }
  return value;
};

/** Validate + apply a settings patch. Throws 400 on invalid input. */
export const updateSettings = async (
  input: SettingsPatchInput | undefined | null
): Promise<WorkspaceSettingsRow> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Request body must be a JSON object');
  }
  const unknown = Object.keys(input).filter(
    (k) => !(EDITABLE_SETTING_KEYS as readonly string[]).includes(k)
  );
  if (unknown.length > 0) {
    throw badRequest(`Unknown setting field(s): ${unknown.join(', ')}`);
  }
  if (Object.keys(input).length === 0) {
    throw badRequest('No editable setting fields provided');
  }

  const patch: WorkspaceSettingsPatch = {};

  if (input.workspace_name !== undefined) {
    if (typeof input.workspace_name !== 'string' || input.workspace_name.trim().length === 0) {
      throw badRequest('workspace_name must be a non-empty string');
    }
    if (input.workspace_name.trim().length > 100) {
      throw badRequest('workspace_name must be at most 100 characters');
    }
    patch.workspace_name = input.workspace_name.trim();
  }

  if (input.timezone !== undefined) {
    if (typeof input.timezone !== 'string' || input.timezone.trim().length === 0) {
      throw badRequest('timezone must be a non-empty string');
    }
    if (input.timezone.trim().length > 60 || !isValidTimezone(input.timezone.trim())) {
      throw badRequest('timezone must be a valid IANA timezone (e.g. Asia/Kolkata, UTC)');
    }
    patch.timezone = input.timezone.trim();
  }

  if (input.default_language !== undefined) {
    if (
      typeof input.default_language !== 'string' ||
      !(SETTING_LANGUAGES as readonly string[]).includes(input.default_language)
    ) {
      throw badRequest(`default_language must be one of: ${SETTING_LANGUAGES.join(', ')}`);
    }
    patch.default_language = input.default_language;
  }

  if (input.lead_score_threshold !== undefined) {
    const num =
      typeof input.lead_score_threshold === 'string' && input.lead_score_threshold.trim() !== ''
        ? Number(input.lead_score_threshold)
        : input.lead_score_threshold;
    if (typeof num !== 'number' || !Number.isInteger(num) || num < 0 || num > 100) {
      throw badRequest('lead_score_threshold must be an integer between 0 and 100');
    }
    patch.lead_score_threshold = num;
  }

  if (input.notify_hot_lead !== undefined) {
    patch.notify_hot_lead = assertBoolean('notify_hot_lead', input.notify_hot_lead);
  }
  if (input.notify_integration_failure !== undefined) {
    patch.notify_integration_failure = assertBoolean('notify_integration_failure', input.notify_integration_failure);
  }
  if (input.notify_followup_due !== undefined) {
    patch.notify_followup_due = assertBoolean('notify_followup_due', input.notify_followup_due);
  }
  if (input.notify_daily_digest !== undefined) {
    patch.notify_daily_digest = assertBoolean('notify_daily_digest', input.notify_daily_digest);
  }

  return updateWorkspaceSettings(patch);
};
