/**
 * Phase 13 – follow-up persistence.
 *
 * Pure persistence for scheduled follow-up actions. No provider knowledge,
 * no business rules, no HTTP: only SQL.
 */
import { pool } from '../database';
import { FollowupAction, FollowupStatus } from '../services/followup/followupTypes';

export interface FollowupRow {
  id: string;
  followup_key: string;
  lead_id: string | null;
  call_id: string | null;
  qualification_id: string | null;
  action: FollowupAction;
  payload: Record<string, unknown>;
  scheduled_at: string;
  status: FollowupStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowupAttemptInput {
  followup_key: string;
  lead_id?: string | null;
  call_id?: string | null;
  qualification_id?: string | null;
  action: FollowupAction;
  payload?: Record<string, unknown> | null;
  scheduled_at: string;
}

export const findFollowupById = async (id: string): Promise<FollowupRow | null> => {
  const result = await pool.query('SELECT * FROM follow_ups WHERE id = $1', [id]);
  return result.rows[0] || null;
};

export interface FollowupListFilter {
  status?: FollowupStatus;
  leadId?: string;
  action?: FollowupAction;
}

/** Paginated follow-up rows, newest first. All filter fields optional. */
export const findFollowups = async (
  filter: FollowupListFilter,
  limit: number,
  offset: number
): Promise<FollowupRow[]> => {
  const clauses: string[] = [];
  const values: any[] = [];
  if (filter.status) {
    values.push(filter.status);
    clauses.push(`status = $${values.length}`);
  }
  if (filter.leadId) {
    values.push(filter.leadId);
    clauses.push(`lead_id = $${values.length}`);
  }
  if (filter.action) {
    values.push(filter.action);
    clauses.push(`action = $${values.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit, offset);
  const result = await pool.query(
    `SELECT * FROM follow_ups ${where} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return result.rows;
};

export const countFollowups = async (filter: FollowupListFilter): Promise<number> => {
  const clauses: string[] = [];
  const values: any[] = [];
  if (filter.status) {
    values.push(filter.status);
    clauses.push(`status = $${values.length}`);
  }
  if (filter.leadId) {
    values.push(filter.leadId);
    clauses.push(`lead_id = $${values.length}`);
  }
  if (filter.action) {
    values.push(filter.action);
    clauses.push(`action = $${values.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await pool.query(`SELECT COUNT(*) AS total FROM follow_ups ${where}`, values);
  return Number(result.rows[0]?.total ?? 0);
};

export const findFollowupByKey = async (key: string): Promise<FollowupRow | null> => {
  const result = await pool.query('SELECT * FROM follow_ups WHERE followup_key = $1', [key]);
  return result.rows[0] || null;
};

/**
 * Insert a follow-up attempt, converging repeated schedules onto the same row.
 * Terminal rows (completed/cancelled) are never overwritten: the existing row
 * is returned untouched so callers can report `duplicate: true`.
 */
export const upsertFollowupAttempt = async (input: FollowupAttemptInput): Promise<FollowupRow> => {
  const existing = await findFollowupByKey(input.followup_key);
  if (existing && (existing.status === 'completed' || existing.status === 'cancelled')) {
    return existing;
  }
  const result = await pool.query(
    `INSERT INTO follow_ups (followup_key, lead_id, call_id, qualification_id, action, payload, scheduled_at, status, attempts)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'pending', 1)
     ON CONFLICT (followup_key) DO UPDATE SET
       status = 'pending',
       attempts = follow_ups.attempts + 1,
       payload = EXCLUDED.payload,
       scheduled_at = EXCLUDED.scheduled_at,
       updated_at = NOW()
     RETURNING *`,
    [
      input.followup_key,
      input.lead_id || null,
      input.call_id || null,
      input.qualification_id || null,
      input.action,
      JSON.stringify(input.payload || {}),
      input.scheduled_at
    ]
  );
  return result.rows[0];
};

/** Rows a future scheduler may execute: due pending rows + retryable failed rows. */
export const findDueFollowups = async (nowIso: string, limit: number): Promise<FollowupRow[]> => {
  const result = await pool.query(
    `SELECT * FROM follow_ups
     WHERE scheduled_at <= $1 AND status IN ('pending', 'failed')
     ORDER BY scheduled_at ASC
     LIMIT $2`,
    [nowIso, limit]
  );
  return result.rows;
};

/**
 * Atomically claim a row for execution. Only pending/failed rows can be
 * claimed; concurrent schedulers converge on a single claim winner.
 */
export const claimFollowupForExecution = async (id: string): Promise<FollowupRow | null> => {
  const result = await pool.query(
    `UPDATE follow_ups
     SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'failed')
     RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
};

/** Recover rows stuck in `processing` past the lease (no sweeper in Phase 13; claim-time recovery only). */
export const recoverStuckProcessing = async (olderThanIso: string, limit: number): Promise<FollowupRow[]> => {
  const result = await pool.query(
    `UPDATE follow_ups
     SET status = 'pending', updated_at = NOW()
     WHERE id IN (
       SELECT id FROM follow_ups
       WHERE status = 'processing' AND updated_at < $1
       ORDER BY updated_at ASC
       LIMIT $2
     )
     RETURNING *`,
    [olderThanIso, limit]
  );
  return result.rows;
};

export const markFollowupCompleted = async (id: string): Promise<FollowupRow> => {
  const result = await pool.query(
    `UPDATE follow_ups
     SET status = 'completed', last_error = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
};

export const markFollowupFailed = async (id: string, lastError: string): Promise<FollowupRow> => {
  const result = await pool.query(
    `UPDATE follow_ups
     SET status = 'failed', last_error = $2, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, lastError]
  );
  return result.rows[0];
};

/** Record a failure and push the due time forward so schedulers back off. */
export const markFollowupFailedWithRetryAt = async (
  id: string,
  lastError: string,
  retryAt: string
): Promise<FollowupRow> => {
  const result = await pool.query(
    `UPDATE follow_ups
     SET status = 'failed', last_error = $2, scheduled_at = $3, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, lastError, retryAt]
  );
  return result.rows[0];
};

/** Re-pend a failed row with a new due time (explicit retry only). */
export const rependFollowupForRetry = async (id: string, scheduledAt: string): Promise<FollowupRow> => {
  const result = await pool.query(
    `UPDATE follow_ups
     SET status = 'pending', scheduled_at = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'failed'
     RETURNING *`,
    [id, scheduledAt]
  );
  return result.rows[0] || null;
};

export const markFollowupCancelled = async (id: string): Promise<FollowupRow | null> => {
  const result = await pool.query(
    `UPDATE follow_ups
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'processing', 'failed')
     RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
};
