/**
 * WhatsApp diagnostics (read-only).
 *
 * Reports structured, secret-free checks using the existing Phase 11
 * architecture: feature flag, provider credential presence (never values),
 * template configuration (names only — content SIDs stay secret),
 * consent-gating mode, database/table reachability, and real delivery
 * history aggregates from `whatsapp_deliveries`. Provider connectivity is
 * NOT probed — a probe would send a message, so it is reported as skipped
 * with the reason. Consent gating is preserved and reported, never faked.
 */
import { pool } from '../../database';
import { getWhatsappConfig, isWhatsappEnabled } from '../../config';
import {
  getWhatsappDeliveryStats,
  listRecentDeliveries,
  WhatsappDeliveryRow
} from '../../repositories/whatsappDeliveryRepository';
import {
  IntegrationDiagnosticCheck,
  IntegrationDiagnosticsOverall
} from '../crm/crmDiagnosticsService';

export interface WhatsappDeliveryHistory {
  total: number;
  delivered: number;
  failed: number;
  lastStatus: string | null;
  lastSyncAt: string | null;
}

export interface WhatsappDiagnostics {
  status: IntegrationDiagnosticsOverall;
  checks: IntegrationDiagnosticCheck[];
  provider: string;
  requireConsent: boolean;
  templateNames: string[];
  history: WhatsappDeliveryHistory;
}

export const WHATSAPP_NOT_CONFIGURED_MESSAGE =
  'WhatsApp is not configured. Add the required provider configuration.';

const tableReachable = async (table: string): Promise<boolean> => {
  try {
    await pool.query(`SELECT 1 FROM ${table} LIMIT 0`);
    return true;
  } catch {
    return false;
  }
};

export const getWhatsappDiagnostics = async (): Promise<WhatsappDiagnostics> => {
  const checks: IntegrationDiagnosticCheck[] = [];

  const enabled = isWhatsappEnabled();
  checks.push({
    name: 'enabled',
    status: enabled ? 'ok' : 'failed',
    message: enabled
      ? 'WhatsApp sending is enabled (WHATSAPP_ENABLED=true)'
      : 'WhatsApp sending is disabled (WHATSAPP_ENABLED=false)'
  });

  const cfg = getWhatsappConfig();
  const hasCredentials = !!(cfg.accountSid && cfg.authToken && cfg.fromNumber);
  checks.push({
    name: 'provider',
    status: hasCredentials ? 'ok' : 'failed',
    message: hasCredentials
      ? `Provider '${cfg.provider}' is configured (account SID, auth token, sender present)`
      : `Provider '${cfg.provider}' is not configured (WHATSAPP_ACCOUNT_SID/WHATSAPP_AUTH_TOKEN/WHATSAPP_FROM_NUMBER missing)`
  });

  const templateNames = Object.keys(cfg.templateSids || {});
  checks.push({
    name: 'templates',
    status: templateNames.length > 0 ? 'ok' : 'failed',
    message:
      templateNames.length > 0
        ? `${templateNames.length} template(s) configured: ${templateNames.join(', ')}`
        : 'No templates configured (WHATSAPP_TEMPLATES_JSON missing)'
  });

  checks.push({
    name: 'consent',
    status: 'ok',
    message: cfg.requireConsent
      ? 'Deny-by-default consent gating is active (sends are skipped without a real opt-in source)'
      : 'Consent requirement overridden (sandbox-only: WHATSAPP_REQUIRE_CONSENT=false)'
  });

  let databaseOk = false;
  try {
    await pool.query('SELECT 1');
    databaseOk = await tableReachable('whatsapp_deliveries');
    checks.push({
      name: 'database',
      status: databaseOk ? 'ok' : 'failed',
      message: databaseOk
        ? 'Database reachable; whatsapp_deliveries table present'
        : 'Database reachable, but the whatsapp_deliveries table is missing'
    });
  } catch {
    checks.push({ name: 'database', status: 'failed', message: 'Database unreachable' });
  }

  let history: WhatsappDeliveryHistory = { total: 0, delivered: 0, failed: 0, lastStatus: null, lastSyncAt: null };
  if (databaseOk) {
    try {
      const stats = await getWhatsappDeliveryStats();
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
            ? 'No delivery attempts recorded yet'
            : `${stats.total} attempt(s): ${stats.delivered} delivered, ${stats.failed} failed`
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
    message: 'Connectivity not attempted (a probe would send a message)'
  });

  const failed = checks.some((c) => c.status === 'failed');
  const status: IntegrationDiagnosticsOverall =
    !enabled || !hasCredentials ? 'not_configured' : failed ? 'error' : 'ok';
  return {
    status,
    checks,
    provider: cfg.provider,
    requireConsent: cfg.requireConsent,
    templateNames,
    history
  };
};

/** Recent delivery attempts for the UI activity list (bounded). */
export const listWhatsappDeliveryHistory = async (limit: number): Promise<WhatsappDeliveryRow[]> => {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;
  return listRecentDeliveries(safeLimit);
};
