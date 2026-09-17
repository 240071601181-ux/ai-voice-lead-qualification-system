/**
 * Phase 10 – n8n delivery status persistence.
 *
 * Pure persistence for outbound n8n workflow deliveries.
 * No n8n knowledge, no business rules, no HTTP: only SQL.
 * One row per (event_id, workflow); concurrent double-fires converge
 * on the same row via the UNIQUE constraint.
 */
import { pool } from '../database';

export type N8nDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'skipped_no_changes';

export interface N8nDeliveryRow {
  id: string;
  event: string;
  event_id: string;
  workflow: string;
  discriminator: number;
  lead_id: string | null;
  call_id: string | null;
  qualification_id: string | null;
  status: N8nDeliveryStatus;
  attempts: number;
  payload_hash: string | null;
  http_status: number | null;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface N8nDeliveryAttemptInput {
  event: string;
  event_id: string;
  workflow: string;
  discriminator: number;
  lead_id?: string | null;
  call_id?: string | null;
  qualification_id?: string | null;
  payload_hash: string;
}

export const findDeliveryByEventId = async (
  eventId: string,
  workflow: string
): Promise<N8nDeliveryRow | null> => {
  const result = await pool.query(
    'SELECT * FROM n8n_deliveries WHERE event_id = $1 AND workflow = $2',
    [eventId, workflow]
  );
  return result.rows[0] || null;
};

export const upsertDeliveryAttempt = async (
  input: N8nDeliveryAttemptInput
): Promise<N8nDeliveryRow> => {
  const result = await pool.query(
    `INSERT INTO n8n_deliveries (event, event_id, workflow, discriminator, lead_id, call_id, qualification_id, status, attempts, payload_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 1, $8)
     ON CONFLICT (event_id, workflow) DO UPDATE SET
       status = 'pending',
       attempts = n8n_deliveries.attempts + 1,
       payload_hash = EXCLUDED.payload_hash,
       updated_at = NOW()
     RETURNING *`,
    [
      input.event,
      input.event_id,
      input.workflow,
      input.discriminator,
      input.lead_id || null,
      input.call_id || null,
      input.qualification_id || null,
      input.payload_hash
    ]
  );
  return result.rows[0];
};

export const markDeliveryDelivered = async (
  id: string,
  httpStatus: number
): Promise<N8nDeliveryRow> => {
  const result = await pool.query(
    `UPDATE n8n_deliveries
     SET status = 'delivered', http_status = $2, last_error = NULL, next_retry_at = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, httpStatus]
  );
  return result.rows[0];
};

export const markDeliverySkipped = async (id: string): Promise<N8nDeliveryRow> => {
  const result = await pool.query(
    `UPDATE n8n_deliveries SET status = 'skipped_no_changes', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
};

export const markDeliveryFailed = async (
  id: string,
  lastError: string,
  httpStatus?: number | null
): Promise<N8nDeliveryRow> => {
  const result = await pool.query(
    `UPDATE n8n_deliveries SET status = 'failed', last_error = $2, http_status = $3, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, lastError, httpStatus ?? null]
  );
  return result.rows[0];
};

export interface N8nDeliveryStats {
  total: number;
  delivered: number;
  failed: number;
  lastStatus: N8nDeliveryStatus | null;
  lastSyncAt: string | null;
}

/**
 * Real delivery history aggregates for diagnostics + metrics. Counts only —
 * no payloads, no webhook URLs, no secrets.
 */
export const getN8nDeliveryStats = async (): Promise<N8nDeliveryStats> => {
  const counts = await pool.query(
    `SELECT status, COUNT(*)::int AS count FROM n8n_deliveries GROUP BY status`
  );
  const byStatus: Record<string, number> = {};
  for (const row of counts.rows) {
    byStatus[row.status] = Number(row.count) || 0;
  }
  const latest = await pool.query(
    `SELECT status, updated_at FROM n8n_deliveries ORDER BY updated_at DESC LIMIT 1`
  );
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  return {
    total,
    delivered: byStatus.delivered || 0,
    failed: byStatus.failed || 0,
    lastStatus: (latest.rows[0]?.status as N8nDeliveryStatus) || null,
    lastSyncAt: latest.rows[0]?.updated_at || null
  };
};

export interface N8nWorkflowDeliveryStat {
  workflow: string;
  deliveries: number;
  lastStatus: N8nDeliveryStatus | null;
  lastDeliveryAt: string | null;
}

/** Per-workflow delivery stats (real rows; workflow names only). */
export const getN8nWorkflowStats = async (): Promise<N8nWorkflowDeliveryStat[]> => {
  const res = await pool.query(
    `SELECT workflow, COUNT(*)::int AS deliveries, MAX(updated_at) AS "lastDeliveryAt"
       FROM n8n_deliveries
      GROUP BY workflow`
  );
  const latest = await pool.query(
    `SELECT DISTINCT ON (workflow) workflow, status
       FROM n8n_deliveries
      ORDER BY workflow, updated_at DESC`
  );
  const lastByWorkflow: Record<string, N8nDeliveryStatus> = {};
  for (const row of latest.rows) {
    lastByWorkflow[row.workflow] = row.status;
  }
  return res.rows.map((row: any) => ({
    workflow: row.workflow,
    deliveries: Number(row.deliveries) || 0,
    lastStatus: lastByWorkflow[row.workflow] || null,
    lastDeliveryAt: row.lastDeliveryAt || null
  }));
};
