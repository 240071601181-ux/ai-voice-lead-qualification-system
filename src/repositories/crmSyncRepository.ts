/**
 * Phase 9 – CRM sync status persistence.
 *
 * Pure persistence for outbound CRM synchronization attempts.
 * No CRM knowledge, no business rules, no HTTP: only SQL.
 */
import { pool } from '../database';

export type CrmSyncStatus = 'pending' | 'success' | 'failed' | 'skipped_no_changes';

export interface CrmSyncRow {
  id: string;
  lead_id: string | null;
  call_id: string | null;
  qualification_id: string | null;
  provider: string;
  idempotency_key: string;
  crm_contact_id: string | null;
  status: CrmSyncStatus;
  attempts: number;
  payload_hash: string | null;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmSyncAttemptInput {
  provider: string;
  lead_id?: string | null;
  call_id?: string | null;
  qualification_id?: string | null;
  idempotency_key: string;
  payload_hash: string;
}

export const findSyncByIdempotencyKey = async (idempotencyKey: string): Promise<CrmSyncRow | null> => {
  const result = await pool.query('SELECT * FROM crm_syncs WHERE idempotency_key = $1', [idempotencyKey]);
  return result.rows[0] || null;
};

export const findLatestSyncByCallId = async (provider: string, callId: string): Promise<CrmSyncRow | null> => {
  const result = await pool.query(
    'SELECT * FROM crm_syncs WHERE provider = $1 AND call_id = $2 ORDER BY updated_at DESC LIMIT 1',
    [provider, callId]
  );
  return result.rows[0] || null;
};

export const findLatestSyncByLeadId = async (provider: string, leadId: string): Promise<CrmSyncRow | null> => {
  const result = await pool.query(
    'SELECT * FROM crm_syncs WHERE provider = $1 AND lead_id = $2 ORDER BY updated_at DESC LIMIT 1',
    [provider, leadId]
  );
  return result.rows[0] || null;
};

export const upsertSyncAttempt = async (input: CrmSyncAttemptInput): Promise<CrmSyncRow> => {
  const result = await pool.query(
    `INSERT INTO crm_syncs (lead_id, call_id, qualification_id, provider, idempotency_key, status, attempts, payload_hash)
     VALUES ($1, $2, $3, $4, $5, 'pending', 1, $6)
     ON CONFLICT (idempotency_key) DO UPDATE SET
       lead_id = COALESCE(EXCLUDED.lead_id, crm_syncs.lead_id),
       call_id = COALESCE(EXCLUDED.call_id, crm_syncs.call_id),
       qualification_id = COALESCE(EXCLUDED.qualification_id, crm_syncs.qualification_id),
       status = 'pending',
       attempts = crm_syncs.attempts + 1,
       payload_hash = EXCLUDED.payload_hash,
       updated_at = NOW()
     RETURNING *`,
    [
      input.lead_id || null,
      input.call_id || null,
      input.qualification_id || null,
      input.provider,
      input.idempotency_key,
      input.payload_hash
    ]
  );
  return result.rows[0];
};

export const markSyncSuccess = async (id: string, crmContactId: string): Promise<CrmSyncRow> => {
  const result = await pool.query(
    `UPDATE crm_syncs
     SET status = 'success', crm_contact_id = $2, last_error = NULL, next_retry_at = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, crmContactId]
  );
  return result.rows[0];
};

export const markSyncSkipped = async (id: string): Promise<CrmSyncRow> => {
  const result = await pool.query(
    `UPDATE crm_syncs SET status = 'skipped_no_changes', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
};

export const markSyncFailed = async (id: string, lastError: string): Promise<CrmSyncRow> => {
  const result = await pool.query(
    `UPDATE crm_syncs SET status = 'failed', last_error = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, lastError]
  );
  return result.rows[0];
};

export interface CrmSyncStats {
  total: number;
  success: number;
  failed: number;
  lastStatus: CrmSyncStatus | null;
  lastSyncAt: string | null;
}

/**
 * Real sync history aggregates for diagnostics + metrics. Counts only —
 * no payloads, no secrets.
 */
export const getCrmSyncStats = async (): Promise<CrmSyncStats> => {
  const counts = await pool.query(
    `SELECT status, COUNT(*)::int AS count FROM crm_syncs GROUP BY status`
  );
  const byStatus: Record<string, number> = {};
  for (const row of counts.rows) {
    byStatus[row.status] = Number(row.count) || 0;
  }
  const latest = await pool.query(
    `SELECT status, updated_at FROM crm_syncs ORDER BY updated_at DESC LIMIT 1`
  );
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  return {
    total,
    success: byStatus.success || 0,
    failed: byStatus.failed || 0,
    lastStatus: (latest.rows[0]?.status as CrmSyncStatus) || null,
    lastSyncAt: latest.rows[0]?.updated_at || null
  };
};

/** Most recent sync attempts (newest first), bounded for UI lists. */
export const listRecentSyncs = async (limit: number): Promise<CrmSyncRow[]> => {
  const res = await pool.query(
    `SELECT id, lead_id, call_id, qualification_id, provider, status, attempts,
            last_error, created_at, updated_at
       FROM crm_syncs
      ORDER BY updated_at DESC
      LIMIT $1`,
    [limit]
  );
  return res.rows;
};
