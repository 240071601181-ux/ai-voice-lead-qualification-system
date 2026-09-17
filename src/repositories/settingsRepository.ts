/**
 * Workspace settings persistence.
 *
 * Single-row table (`workspace_settings`, id = 1). Pure SQL only: no
 * business rules, no secrets. The service layer validates; this module
 * only reads/writes the row, seeding defaults when the row is missing
 * (e.g. migration not yet applied).
 */
import { pool } from '../database';

export interface WorkspaceSettingsRow {
  id: number;
  workspace_name: string;
  timezone: string;
  default_language: string;
  lead_score_threshold: number;
  notify_hot_lead: boolean;
  notify_integration_failure: boolean;
  notify_followup_due: boolean;
  notify_daily_digest: boolean;
  created_at: string;
  updated_at: string;
}

export type WorkspaceSettingsPatch = Partial<
  Pick<
    WorkspaceSettingsRow,
    | 'workspace_name'
    | 'timezone'
    | 'default_language'
    | 'lead_score_threshold'
    | 'notify_hot_lead'
    | 'notify_integration_failure'
    | 'notify_followup_due'
    | 'notify_daily_digest'
  >
>;

const COLUMNS = [
  'workspace_name',
  'timezone',
  'default_language',
  'lead_score_threshold',
  'notify_hot_lead',
  'notify_integration_failure',
  'notify_followup_due',
  'notify_daily_digest'
] as const;

export const getWorkspaceSettings = async (): Promise<WorkspaceSettingsRow> => {
  const existing = await pool.query('SELECT * FROM workspace_settings WHERE id = 1');
  if (existing.rows[0]) return existing.rows[0];
  const seeded = await pool.query(
    'INSERT INTO workspace_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING RETURNING *'
  );
  if (seeded.rows[0]) return seeded.rows[0];
  const reread = await pool.query('SELECT * FROM workspace_settings WHERE id = 1');
  return reread.rows[0];
};

export const updateWorkspaceSettings = async (
  patch: WorkspaceSettingsPatch
): Promise<WorkspaceSettingsRow> => {
  const keys = Object.keys(patch).filter((k) =>
    (COLUMNS as readonly string[]).includes(k)
  ) as Array<keyof WorkspaceSettingsPatch>;
  if (keys.length === 0) {
    return getWorkspaceSettings();
  }
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => patch[k]);
  const res = await pool.query(
    `UPDATE workspace_settings SET ${sets}, updated_at = NOW() WHERE id = 1 RETURNING *`,
    values
  );
  if (res.rows[0]) return res.rows[0];
  return getWorkspaceSettings();
};
