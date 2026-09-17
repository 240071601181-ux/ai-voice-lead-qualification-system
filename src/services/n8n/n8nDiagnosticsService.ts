/**
 * n8n diagnostics (read-only) + configured-workflow inventory.
 *
 * Reports structured, secret-free checks using the existing Phase 10
 * architecture: feature flag, webhook-secret presence (never the value),
 * configured workflows from N8N_WORKFLOWS_JSON / N8N_WEBHOOK_URL (names and
 * events only — URLs stay secret), database/table reachability, and real
 * delivery history aggregates from `n8n_deliveries`. Webhook connectivity
 * is NOT probed — a probe would fire real workflows, so it is reported as
 * skipped with the reason.
 */
import { pool } from '../../database';
import { getN8nConfig, isN8nEnabled } from '../../config';
import {
  getN8nDeliveryStats,
  getN8nWorkflowStats,
  N8nDeliveryStatus
} from '../../repositories/n8nDeliveryRepository';
import {
  IntegrationDiagnosticCheck,
  IntegrationDiagnosticsOverall
} from '../crm/crmDiagnosticsService';

export interface N8nDeliveryHistory {
  total: number;
  delivered: number;
  failed: number;
  lastStatus: string | null;
  lastSyncAt: string | null;
}

export interface N8nDiagnostics {
  status: IntegrationDiagnosticsOverall;
  checks: IntegrationDiagnosticCheck[];
  workflowCount: number;
  eventCount: number;
  history: N8nDeliveryHistory;
}

export interface N8nWorkflowStatus {
  event: string;
  name: string;
  urlConfigured: boolean;
  deliveries: number;
  lastStatus: N8nDeliveryStatus | null;
  lastDeliveryAt: string | null;
}

export const N8N_NOT_CONFIGURED_MESSAGE = 'n8n is not configured.';

const tableReachable = async (table: string): Promise<boolean> => {
  try {
    await pool.query(`SELECT 1 FROM ${table} LIMIT 0`);
    return true;
  } catch {
    return false;
  }
};

export const getN8nDiagnostics = async (): Promise<N8nDiagnostics> => {
  const checks: IntegrationDiagnosticCheck[] = [];

  const enabled = isN8nEnabled();
  checks.push({
    name: 'enabled',
    status: enabled ? 'ok' : 'failed',
    message: enabled
      ? 'n8n emission is enabled (N8N_ENABLED=true)'
      : 'n8n emission is disabled (N8N_ENABLED=false)'
  });

  const cfg = getN8nConfig();
  checks.push({
    name: 'secret',
    status: cfg.webhookSecret ? 'ok' : 'failed',
    message: cfg.webhookSecret
      ? 'Webhook secret is present'
      : 'Webhook secret is missing (N8N_WEBHOOK_SECRET not set)'
  });

  const events = Object.keys(cfg.workflows || {});
  const targets = events.reduce((sum, event) => sum + (cfg.workflows[event]?.length || 0), 0);
  checks.push({
    name: 'workflows',
    status: targets > 0 ? 'ok' : 'failed',
    message:
      targets > 0
        ? `${targets} workflow target(s) across ${events.length} event(s): ${events.join(', ')}`
        : 'No workflows configured (N8N_WORKFLOWS_JSON or N8N_WEBHOOK_URL missing)'
  });

  let databaseOk = false;
  try {
    await pool.query('SELECT 1');
    databaseOk = await tableReachable('n8n_deliveries');
    checks.push({
      name: 'database',
      status: databaseOk ? 'ok' : 'failed',
      message: databaseOk
        ? 'Database reachable; n8n_deliveries table present'
        : 'Database reachable, but the n8n_deliveries table is missing'
    });
  } catch {
    checks.push({ name: 'database', status: 'failed', message: 'Database unreachable' });
  }

  let history: N8nDeliveryHistory = { total: 0, delivered: 0, failed: 0, lastStatus: null, lastSyncAt: null };
  if (databaseOk) {
    try {
      const stats = await getN8nDeliveryStats();
      history = {
        total: stats.total,
        delivered: stats.delivered,
        failed: stats.failed,
        lastStatus: stats.lastStatus,
        lastSyncAt: stats.lastSyncAt
      };
      checks.push({
        name: 'history',
        status: 'ok',
        message:
          stats.total === 0
            ? 'No deliveries recorded yet'
            : `${stats.total} deliverie(s): ${stats.delivered} delivered, ${stats.failed} failed`
      });
    } catch {
      checks.push({ name: 'history', status: 'failed', message: 'Could not read delivery history' });
    }
  } else {
    checks.push({ name: 'history', status: 'skipped', message: 'Skipped (database unreachable)' });
  }

  checks.push({
    name: 'connectivity',
    status: 'skipped',
    message: 'Connectivity not attempted (a probe would fire real workflows)'
  });

  const failed = checks.some((c) => c.status === 'failed');
  const status: IntegrationDiagnosticsOverall =
    !enabled || !cfg.webhookSecret || targets === 0 ? 'not_configured' : failed ? 'error' : 'ok';
  return { status, checks, workflowCount: targets, eventCount: events.length, history };
};

/**
 * Configured workflows with real delivery stats. Only persisted/configured
 * workflows appear — no execution counts are invented (deliveries counts
 * come from `n8n_deliveries`; URLs are never exposed).
 */
export const listN8nWorkflows = async (): Promise<N8nWorkflowStatus[]> => {
  const cfg = getN8nConfig();
  const stats = await getN8nWorkflowStats();
  const byWorkflow: Record<string, { deliveries: number; lastStatus: N8nDeliveryStatus | null; lastDeliveryAt: string | null }> = {};
  for (const stat of stats) {
    byWorkflow[stat.workflow] = {
      deliveries: stat.deliveries,
      lastStatus: stat.lastStatus,
      lastDeliveryAt: stat.lastDeliveryAt
    };
  }
  const out: N8nWorkflowStatus[] = [];
  for (const [event, targets] of Object.entries(cfg.workflows || {})) {
    for (const target of targets || []) {
      const stat = byWorkflow[target.name];
      out.push({
        event,
        name: target.name,
        urlConfigured: !!target.url,
        deliveries: stat?.deliveries || 0,
        lastStatus: stat?.lastStatus || null,
        lastDeliveryAt: stat?.lastDeliveryAt || null
      });
    }
  }
  return out;
};
