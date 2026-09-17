/**
 * CRM diagnostics (read-only) + explicit sync entry point.
 *
 * Reports structured, secret-free checks using the existing Phase 9
 * architecture: feature flag, provider configuration presence (never
 * values), database/table reachability, and real sync history aggregates
 * from `crm_syncs`. Provider connectivity is NOT probed — a probe would
 * write a contact, so it is reported as skipped with the reason.
 */
import { pool } from '../../database';
import { getCrmConfig, isCrmEnabled } from '../../config';
import { getCrmSyncStats, listRecentSyncs, CrmSyncRow } from '../../repositories/crmSyncRepository';
import { syncCrmContactOnce, CrmSyncOutcome } from './crmSyncService';

export type IntegrationDiagnosticStatus = 'ok' | 'failed' | 'skipped';

export interface IntegrationDiagnosticCheck {
  name: string;
  status: IntegrationDiagnosticStatus;
  message: string;
}

export type IntegrationDiagnosticsOverall = 'ok' | 'not_configured' | 'error';

export interface CrmSyncHistory {
  total: number;
  success: number;
  failed: number;
  lastStatus: string | null;
  lastSyncAt: string | null;
}

export interface CrmDiagnostics {
  status: IntegrationDiagnosticsOverall;
  checks: IntegrationDiagnosticCheck[];
  provider: string;
  history: CrmSyncHistory;
}

export const CRM_NOT_CONFIGURED_MESSAGE =
  'CRM is not configured. Add the required provider configuration.';

const tableReachable = async (table: string): Promise<boolean> => {
  try {
    await pool.query(`SELECT 1 FROM ${table} LIMIT 0`);
    return true;
  } catch {
    return false;
  }
};

export const getCrmDiagnostics = async (): Promise<CrmDiagnostics> => {
  const checks: IntegrationDiagnosticCheck[] = [];

  const enabled = isCrmEnabled();
  checks.push({
    name: 'enabled',
    status: enabled ? 'ok' : 'failed',
    message: enabled
      ? 'CRM sync is enabled (CRM_SYNC_ENABLED=true)'
      : 'CRM sync is disabled (CRM_SYNC_ENABLED=false)'
  });

  const cfg = getCrmConfig();
  const hasConfig = !!(cfg.baseUrl && cfg.apiKey);
  checks.push({
    name: 'provider',
    status: hasConfig ? 'ok' : 'failed',
    message: hasConfig
      ? `Provider '${cfg.provider}' is configured (base URL + API key present)`
      : `Provider '${cfg.provider}' is not configured (CRM_BASE_URL/CRM_API_KEY missing)`
  });

  let databaseOk = false;
  try {
    await pool.query('SELECT 1');
    databaseOk = await tableReachable('crm_syncs');
    checks.push({
      name: 'database',
      status: databaseOk ? 'ok' : 'failed',
      message: databaseOk
        ? 'Database reachable; crm_syncs table present'
        : 'Database reachable, but the crm_syncs table is missing'
    });
  } catch {
    checks.push({ name: 'database', status: 'failed', message: 'Database unreachable' });
  }

  let history: CrmSyncHistory = { total: 0, success: 0, failed: 0, lastStatus: null, lastSyncAt: null };
  if (databaseOk) {
    try {
      const stats = await getCrmSyncStats();
      history = {
        total: stats.total,
        success: stats.success,
        failed: stats.failed,
        lastStatus: stats.lastStatus,
        lastSyncAt: stats.lastSyncAt
      };
      checks.push({
        name: 'history',
        status: 'ok',
        message:
          stats.total === 0
            ? 'No sync attempts recorded yet'
            : `${stats.total} attempt(s): ${stats.success} succeeded, ${stats.failed} failed`
      });
    } catch {
      checks.push({ name: 'history', status: 'failed', message: 'Could not read sync history' });
    }
  } else {
    checks.push({ name: 'history', status: 'skipped', message: 'Skipped (database unreachable)' });
  }

  checks.push({
    name: 'connectivity',
    status: 'skipped',
    message: 'Connectivity not attempted (a probe would write a CRM contact)'
  });

  const failed = checks.some((c) => c.status === 'failed');
  const status: IntegrationDiagnosticsOverall =
    !enabled || !hasConfig ? 'not_configured' : failed ? 'error' : 'ok';
  return { status, checks, provider: cfg.provider, history };
};

export interface CrmSyncNowResult {
  outcome: CrmSyncOutcome;
  message: string;
}

/**
 * Explicit operator-triggered sync for one lead/call. Reuses the existing
 * sync orchestrator (bounded retries, sanitized errors, persisted rows) —
 * this is the same code path as the post-qualification tail, not a parallel
 * implementation.
 */
export const runCrmSyncNow = async (input: {
  leadId?: unknown;
  callId?: unknown;
}): Promise<CrmSyncNowResult> => {
  const leadId = typeof input.leadId === 'string' && input.leadId.trim() ? input.leadId.trim() : null;
  const callId = typeof input.callId === 'string' && input.callId.trim() ? input.callId.trim() : null;
  if (!leadId && !callId) {
    const err: any = new Error('leadId or callId is required');
    err.status = 400;
    throw err;
  }
  const outcome = await syncCrmContactOnce({ leadId, callId });
  if (outcome.ok) {
    return {
      outcome,
      message: outcome.skipped === 'no_changes' ? 'CRM contact already up to date' : 'CRM sync completed'
    };
  }
  const messageBySkip: Record<string, { status: number; message: string }> = {
    disabled: { status: 503, message: 'CRM sync is disabled (CRM_SYNC_ENABLED=false)' },
    no_config: { status: 503, message: CRM_NOT_CONFIGURED_MESSAGE },
    no_input: { status: 400, message: 'leadId or callId is required' },
    no_data: { status: 404, message: 'No lead, call, or qualification data found for this sync' }
  };
  const mapped = outcome.skipped ? messageBySkip[outcome.skipped] : undefined;
  if (mapped) {
    const err: any = new Error(mapped.message);
    err.status = mapped.status;
    throw err;
  }
  const err: any = new Error('CRM sync failed (provider_error)');
  err.status = 502;
  throw err;
};

/** Recent sync attempts for the UI activity list (bounded). */
export const listCrmSyncHistory = async (limit: number): Promise<CrmSyncRow[]> => {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;
  return listRecentSyncs(safeLimit);
};
