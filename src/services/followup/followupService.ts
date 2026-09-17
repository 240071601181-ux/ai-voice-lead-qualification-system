/**
 * Phase 13 – follow-up scheduling/execution orchestrator (all business logic lives here).
 *
 * Schedules qualification-driven follow-ups as persistent rows and executes
 * them by reusing the existing Phase 9 (CRM) and Phase 11 (WhatsApp)
 * single-attempt functions. No duplicate providers, no new templates,
 * no qualification-scoring changes.
 *
 * Hard guarantees:
 * - NEVER in the real-time path: creation is enqueued via
 *   `enqueueFollowupScheduling` (fire-and-forget `setImmediate`); execution
 *   happens only through `executeFollowupOnce` / `executeDueFollowUps`,
 *   which a future scheduler calls. Callers must not `await` scheduling
 *   from webhooks, and webhooks never execute follow-ups inline.
 * - NEVER throws to callers: every operation resolves with an outcome and
 *   persists `failed`/`cancelled` rows + sanitized logs only.
 * - Independent from qualification scoring: tier is read verbatim from the
 *   persisted qualification; COLD never schedules automatically.
 * - WhatsApp consent is never bypassed: the deny-by-default gate stays
 *   inside `whatsappSender`; benign skips (no consent/phone/template)
 *   complete the follow-up instead of retrying forever.
 * - NEVER logs or persists secrets, tokens, or full phone numbers.
 * - Idempotent: stable follow-up key per action+anchor; terminal
 *   (completed/cancelled) rows are never overwritten.
 */
import { LeadService } from '../leadService';
import { findCallById } from '../../repositories/callRepository';
import { getStateByCallId } from '../conversationStateService';
import { findQualificationByCallId } from '../../repositories/qualificationRepository';
import { hasMeaningfulContact } from '../whatsapp/whatsappMessageBuilder';
import { WhatsappTemplateName } from '../whatsapp/whatsappProvider';
import { sendWhatsappOnce } from '../whatsapp/whatsappSender';
import { syncCrmContactOnce } from '../crm/crmSyncService';
import { withCrmRetry } from '../crm/crmRetry';
import { buildFollowupKey, FollowupAction } from './followupTypes';
import { resolveFollowupPlan, scheduledAtFor } from './followupPolicy';
import {
  claimFollowupForExecution,
  countFollowups,
  findDueFollowups,
  findFollowupById,
  findFollowupByKey,
  findFollowups,
  FollowupListFilter,
  markFollowupCancelled,
  markFollowupCompleted,
  markFollowupFailed,
  markFollowupFailedWithRetryAt,
  recoverStuckProcessing,
  rependFollowupForRetry,
  upsertFollowupAttempt,
  FollowupRow
} from '../../repositories/followupRepository';
import { getFollowupConfig, isFollowupEnabled } from '../../config';
import { logger } from '../../utils/logger';

export interface FollowupScheduleInput {
  leadId?: string | null;
  callId?: string | null;
  action: FollowupAction;
  /** ISO datetime when the follow-up becomes due. Defaults to now (immediately due). */
  scheduledAt?: string | null;
  /** Only for `whatsapp_followup`: existing template name. Policy supplies this. */
  template?: WhatsappTemplateName | null;
}

export interface FollowupScheduleOutcome {
  ok: boolean;
  created?: boolean;
  duplicate?: boolean;
  followup?: FollowupRow | null;
  skipped?: 'disabled' | 'no_input' | 'no_data' | 'tier' | 'invalid_action' | 'invalid_template';
}

export interface FollowupExecuteOutcome {
  ok: boolean;
  completed?: boolean;
  followup?: FollowupRow | null;
  skipped?: 'disabled' | 'not_found' | 'not_due' | 'already_terminal' | 'claim_lost' | 'max_attempts';
}

export interface DueExecutionOutcome {
  ok: boolean;
  checked: number;
  completed: number;
  failed: number;
  skipped?: 'disabled';
}

/** Remove secrets/tokens/numbers from error text before logging or persisting. */
export const sanitizeFollowupErrorMessage = (err: any): string => {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown follow-up error');
  const cfg = getFollowupConfigSafe();
  let clean = raw;
  for (const secret of cfg.secrets) {
    if (secret && secret.length > 0) {
      clean = clean.split(secret).join('[REDACTED]');
    }
  }
  clean = clean
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/g, 'Bearer [REDACTED]')
    .replace(/api[_-]?key\s*[:=]\s*['"]?[^'"\s,}]+['"]?/gi, 'api_key=[REDACTED]')
    .replace(/token\s*[:=]\s*['"]?[^'"\s,}]+['"]?/gi, 'token=[REDACTED]')
    .replace(/secret\s*[:=]\s*['"]?[^'"\s,}]+['"]?/gi, 'secret=[REDACTED]')
    .replace(/whatsapp:\+\d+/gi, 'whatsapp:[REDACTED]')
    .replace(/\+\d{8,15}/g, '[REDACTED]');
  if (clean.length > 500) clean = clean.slice(0, 500);
  return clean;
};

const getFollowupConfigSafe = (): { secrets: string[] } => {
  try {
    // Secrets live in other phases' configs; follow-up stores none itself.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCrmConfig, getN8nConfig, getWhatsappConfig } = require('../../config') as typeof import('../../config');
    const secrets: string[] = [];
    try {
      const v = getCrmConfig().apiKey;
      if (v) secrets.push(v);
    } catch { /* ignore */ }
    try {
      const v = getN8nConfig().webhookSecret;
      if (v) secrets.push(v);
    } catch { /* ignore */ }
    try {
      const c = getWhatsappConfig();
      if (c.authToken) secrets.push(c.authToken);
      if (c.accountSid) secrets.push(c.accountSid);
    } catch { /* ignore */ }
    return { secrets };
  } catch {
    return { secrets: [] };
  }
};

const leadService = new LeadService();

const ALLOWED_WHATSAPP_TEMPLATES: WhatsappTemplateName[] = [
  'lead_welcome',
  'call_summary_hot',
  'call_summary_warm',
  'call_missed'
];

/**
 * Fire-and-forget scheduling entry point for async tails (vapiService,
 * qualificationController). Never throws, never blocks the webhook response.
 */
export const enqueueFollowupScheduling = (input: {
  leadId?: string | null;
  callId?: string | null;
}): void => {
  if (!isFollowupEnabled()) return;
  setImmediate(() => {
    scheduleFollowupsForEvent(input).catch((err: any) => {
      logger.error('Follow-up scheduling failed', {
        error: sanitizeFollowupErrorMessage(err),
        leadId: input.leadId || null,
        callId: input.callId || null
      });
    });
  });
};

/**
 * Resolve the qualification-driven plan for a persisted event and schedule
 * each item. Resolves (never rejects) with one outcome per planned item.
 * COLD tiers and unknown states with meaningful contact schedule nothing.
 */
export interface FollowupListOptions extends FollowupListFilter {
  page: number;
  limit: number;
}

export interface FollowupListResult {
  followups: FollowupRow[];
  total: number;
  page: number;
  limit: number;
}

/** Paginated follow-up rows, newest first. Read-only; no policy applied. */
export const listFollowups = async (opts: FollowupListOptions): Promise<FollowupListResult> => {
  const offset = (opts.page - 1) * opts.limit;
  const filter: FollowupListFilter = {
    status: opts.status,
    leadId: opts.leadId,
    action: opts.action
  };
  const [followups, total] = await Promise.all([
    findFollowups(filter, opts.limit, offset),
    countFollowups(filter)
  ]);
  return { followups, total, page: opts.page, limit: opts.limit };
};

export const scheduleFollowupsForEvent = async (input: {
  leadId?: string | null;
  callId?: string | null;
  now?: Date;
}): Promise<FollowupScheduleOutcome[]> => {
  if (!isFollowupEnabled()) return [{ ok: false, skipped: 'disabled' }];
  const callId = input.callId || null;
  const inputLeadId = input.leadId || null;
  if (!callId && !inputLeadId) return [{ ok: false, skipped: 'no_input' }];

  try {
    const [call, state, qualification] = await Promise.all([
      callId ? findCallById(callId) : Promise.resolve(null),
      callId ? getStateByCallId(callId) : Promise.resolve(null),
      callId ? findQualificationByCallId(callId) : Promise.resolve(null)
    ]);
    const leadId = inputLeadId || state?.lead_id || call?.lead_id || qualification?.lead_id || null;
    const lead = leadId ? await leadService.getLead(leadId).catch(() => null) : null;
    if (!lead && !call && !state && !qualification) {
      return [{ ok: false, skipped: 'no_data' }];
    }

    const cfg = getFollowupConfig();
    const now = input.now || new Date();
    const tier = qualification?.tier || null;
    const plan = resolveFollowupPlan(
      { tier, hasMeaningfulContact: hasMeaningfulContact(state) },
      { hotDelayMin: cfg.hotDelayMin, warmDelayMin: cfg.warmDelayMin, crmDelayMin: cfg.crmDelayMin }
    );
    if (plan.length === 0) {
      return [{ ok: false, skipped: 'tier' }];
    }

    const outcomes: FollowupScheduleOutcome[] = [];
    for (const item of plan) {
      outcomes.push(
        await scheduleFollowup({
          leadId,
          callId,
          action: item.action,
          scheduledAt: scheduledAtFor(now, item.delayMin),
          template: item.template || null
        })
      );
    }
    return outcomes;
  } catch (err: any) {
    logger.error('Follow-up scheduling failed', {
      error: sanitizeFollowupErrorMessage(err),
      leadId: inputLeadId,
      callId
    });
    return [{ ok: false }];
  }
};

/**
 * Schedule a single follow-up row. Idempotent: repeated calls with the same
 * action+anchor converge on one pending row; terminal rows are returned as
 * duplicates without modification. Resolves, never rejects.
 */
export const scheduleFollowup = async (
  input: FollowupScheduleInput
): Promise<FollowupScheduleOutcome> => {
  if (!isFollowupEnabled()) return { ok: false, skipped: 'disabled' };
  const callId = input.callId || null;
  const inputLeadId = input.leadId || null;
  if (!callId && !inputLeadId) return { ok: false, skipped: 'no_input' };
  if (input.action !== 'whatsapp_followup' && input.action !== 'crm_followup' && input.action !== 'missed_reminder') {
    return { ok: false, skipped: 'invalid_action' };
  }
  if (input.action === 'whatsapp_followup' && input.template) {
    if (!ALLOWED_WHATSAPP_TEMPLATES.includes(input.template)) {
      return { ok: false, skipped: 'invalid_template' };
    }
  }

  try {
    const [call, state, qualification] = await Promise.all([
      callId ? findCallById(callId) : Promise.resolve(null),
      callId ? getStateByCallId(callId) : Promise.resolve(null),
      callId ? findQualificationByCallId(callId) : Promise.resolve(null)
    ]);
    const leadId = inputLeadId || state?.lead_id || call?.lead_id || qualification?.lead_id || null;
    if (!call && !state && !qualification && !leadId) {
      return { ok: false, skipped: 'no_data' };
    }
    // COLD never schedules automatically, even via explicit schedule calls.
    if (qualification && qualification.tier === 'COLD') {
      return { ok: false, skipped: 'tier' };
    }

    const anchor = call?.id || state?.call_id || qualification?.call_id || (leadId as string);
    const baseKey = buildFollowupKey(input.action, anchor);
    const previous = await findFollowupByKey(baseKey);
    if (previous && (previous.status === 'completed' || previous.status === 'cancelled')) {
      return { ok: true, duplicate: true, followup: previous };
    }
    const discriminator = previous && previous.status !== 'failed' ? 2 : 1;
    const followupKey =
      discriminator > 1 ? buildFollowupKey(input.action, anchor, discriminator) : baseKey;

    const scheduledAt = input.scheduledAt || new Date().toISOString();
    const row = await upsertFollowupAttempt({
      followup_key: followupKey,
      lead_id: leadId,
      call_id: callId,
      qualification_id: qualification?.id || null,
      action: input.action,
      payload: input.action === 'whatsapp_followup' && input.template ? { template: input.template } : {},
      scheduled_at: scheduledAt
    });
    logger.info('Follow-up scheduled', { action: input.action, leadId, callId });
    return { ok: true, created: true, followup: row };
  } catch (err: any) {
    logger.error('Follow-up scheduling failed', {
      error: sanitizeFollowupErrorMessage(err),
      leadId: inputLeadId,
      callId
    });
    return { ok: false };
  }
};

/**
 * Execute a single follow-up by id: atomically claim, dispatch to the
 * existing WhatsApp/CRM function, and mark terminal. Resolves, never rejects.
 */
export const executeFollowupOnce = async (id: string): Promise<FollowupExecuteOutcome> => {
  if (!isFollowupEnabled()) return { ok: false, skipped: 'disabled' };
  try {
    const existing = await findFollowupById(id);
    if (!existing) return { ok: false, skipped: 'not_found' };
    if (existing.status === 'completed' || existing.status === 'cancelled') {
      return { ok: false, skipped: 'already_terminal', followup: existing };
    }
    const cfg = getFollowupConfig();
    if (existing.attempts >= cfg.maxAttempts && existing.status === 'failed') {
      return { ok: false, skipped: 'max_attempts', followup: existing };
    }

    const claimed = await claimFollowupForExecution(id);
    if (!claimed) return { ok: false, skipped: 'claim_lost', followup: existing };

    try {
      const dispatchOutcome = await withCrmRetry(
        () => dispatchFollowupAction(claimed),
        { maxRetries: cfg.maxRetries, baseDelayMs: cfg.baseDelayMs }
      );
      if (dispatchOutcome.ok) {
        const done = await markFollowupCompleted(claimed.id);
        logger.info('Follow-up completed', { action: claimed.action, leadId: claimed.lead_id, callId: claimed.call_id });
        return { ok: true, completed: true, followup: done };
      }
      // Retryable failure: record + push the due time forward so the future
      // scheduler does not hammer it.
      const retryAt = new Date(Date.now() + cfg.baseDelayMs * Math.pow(2, Math.min(claimed.attempts, 5))).toISOString();
      const failed = await markFollowupFailedWithRetryAt(claimed.id, dispatchOutcome.error || 'Follow-up dispatch failed', retryAt);
      logger.error('Follow-up execution failed', {
        error: sanitizeFollowupErrorMessage(dispatchOutcome.error || 'Follow-up dispatch failed'),
        action: claimed.action,
        leadId: claimed.lead_id,
        callId: claimed.call_id
      });
      return { ok: false, followup: failed };
    } catch (dispatchErr: any) {
      const message = sanitizeFollowupErrorMessage(dispatchErr);
      const retryAt = new Date(Date.now() + cfg.baseDelayMs * Math.pow(2, Math.min(claimed.attempts, 5))).toISOString();
      const failed = await markFollowupFailedWithRetryAt(claimed.id, message, retryAt);
      logger.error('Follow-up execution failed', {
        error: message,
        action: claimed.action,
        leadId: claimed.lead_id,
        callId: claimed.call_id
      });
      return { ok: false, followup: failed };
    }
  } catch (err: any) {
    const message = sanitizeFollowupErrorMessage(err);
    try {
      const row = await findFollowupById(id);
      if (row) await markFollowupFailed(row.id, message);
    } catch { /* persistence best-effort */ }
    logger.error('Follow-up execution failed', { error: message });
    return { ok: false };
  }
};

/** Dispatch a claimed row to the existing downstream function. Never throws benign skips as errors. */
const dispatchFollowupAction = async (
  row: FollowupRow
): Promise<{ ok: boolean; error?: string }> => {
  const leadId = row.lead_id;
  const callId = row.call_id;

  if (row.action === 'crm_followup') {
    const outcome = await syncCrmContactOnce({ leadId, callId });
    if (outcome.ok) return { ok: true };
    return { ok: false, error: `CRM follow-up not completed (${outcome.skipped || 'provider_error'})` };
  }

  if (row.action === 'whatsapp_followup') {
    const payload = (row.payload || {}) as { template?: unknown };
    const template = typeof payload.template === 'string' ? payload.template : null;
    if (!template || !ALLOWED_WHATSAPP_TEMPLATES.includes(template as WhatsappTemplateName)) {
      return { ok: false, error: 'WhatsApp follow-up has no valid template' };
    }
    const outcome = await sendWhatsappOnce({
      template: template as WhatsappTemplateName,
      leadId,
      callId
    });
    if (outcome.ok) return { ok: true };
    // Benign skips complete the follow-up: retrying consent/phone/template
    // denials would loop forever and would bypass Phase 11 policy.
    if (outcome.skipped === 'no_consent' || outcome.skipped === 'no_phone' || outcome.skipped === 'suppressed' || outcome.skipped === 'no_template' || outcome.skipped === 'no_changes') {
      return { ok: true };
    }
    return { ok: false, error: `WhatsApp follow-up not completed (${outcome.skipped || 'provider_error'})` };
  }

  // missed_reminder: re-read current state; a reminder is only needed when
  // the contact is still without meaningful requirements.
  const state = callId ? await getStateByCallId(callId) : null;
  if (hasMeaningfulContact(state)) return { ok: true };
  const outcome = await sendWhatsappOnce({ template: 'call_missed', leadId, callId });
  if (outcome.ok) return { ok: true };
  if (outcome.skipped === 'no_consent' || outcome.skipped === 'no_phone' || outcome.skipped === 'suppressed' || outcome.skipped === 'no_template' || outcome.skipped === 'no_changes') {
    return { ok: true };
  }
  return { ok: false, error: `Missed-reminder not completed (${outcome.skipped || 'provider_error'})` };
};

/**
 * Future-scheduler entry point: recover stuck claims, fetch due rows, and
 * execute each via `executeFollowupOnce`. Bounded by `limit`. Resolves,
 * never rejects. No timers/queues/workers are created here.
 */
export const executeDueFollowUps = async (opts?: {
  limit?: number;
  now?: Date;
}): Promise<DueExecutionOutcome> => {
  if (!isFollowupEnabled()) return { ok: false, checked: 0, completed: 0, failed: 0, skipped: 'disabled' };
  try {
    const cfg = getFollowupConfig();
    const limit = Math.max(1, Math.min(opts?.limit || cfg.executeLimit, 100));
    const now = opts?.now || new Date();
    const leaseCutoff = new Date(now.getTime() - cfg.processingTimeoutMs).toISOString();
    await recoverStuckProcessing(leaseCutoff, limit).catch(() => []);
    const due = await findDueFollowups(now.toISOString(), limit);
    let completed = 0;
    let failed = 0;
    for (const row of due) {
      if (row.status === 'failed' && row.attempts >= cfg.maxAttempts) continue;
      const outcome = await executeFollowupOnce(row.id);
      if (outcome.ok) completed++;
      else failed++;
    }
    return { ok: true, checked: due.length, completed, failed };
  } catch (err: any) {
    logger.error('Follow-up due execution failed', { error: sanitizeFollowupErrorMessage(err) });
    return { ok: false, checked: 0, completed: 0, failed: 0 };
  }
};

/** Cancel a pending/processing/failed follow-up. Terminal rows cannot be re-cancelled. Resolves, never rejects. */
export const cancelFollowup = async (
  id: string
): Promise<{ ok: boolean; followup?: FollowupRow | null; skipped?: 'disabled' | 'not_found' | 'already_terminal' }> => {
  if (!isFollowupEnabled()) return { ok: false, skipped: 'disabled' };
  try {
    const existing = await findFollowupById(id);
    if (!existing) return { ok: false, skipped: 'not_found' };
    if (existing.status === 'completed' || existing.status === 'cancelled') {
      return { ok: false, skipped: 'already_terminal', followup: existing };
    }
    const cancelled = await markFollowupCancelled(id);
    if (!cancelled) return { ok: false, skipped: 'already_terminal', followup: existing };
    logger.info('Follow-up cancelled', { action: existing.action, leadId: existing.lead_id, callId: existing.call_id });
    return { ok: true, followup: cancelled };
  } catch (err: any) {
    logger.error('Follow-up cancellation failed', { error: sanitizeFollowupErrorMessage(err) });
    return { ok: false };
  }
};

/** Explicit retry of a failed follow-up: re-pend with backoff when attempts remain. Resolves, never rejects. */
export const retryFollowup = async (
  id: string
): Promise<{ ok: boolean; followup?: FollowupRow | null; skipped?: 'disabled' | 'not_found' | 'not_failed' | 'max_attempts' }> => {
  if (!isFollowupEnabled()) return { ok: false, skipped: 'disabled' };
  try {
    const existing = await findFollowupById(id);
    if (!existing) return { ok: false, skipped: 'not_found' };
    if (existing.status !== 'failed') return { ok: false, skipped: 'not_failed', followup: existing };
    const cfg = getFollowupConfig();
    if (existing.attempts >= cfg.maxAttempts) {
      return { ok: false, skipped: 'max_attempts', followup: existing };
    }
    const retryAt = new Date(Date.now() + cfg.baseDelayMs * Math.pow(2, Math.min(existing.attempts, 5))).toISOString();
    const repended = await rependFollowupForRetry(id, retryAt);
    if (!repended) return { ok: false, skipped: 'not_failed', followup: existing };
    logger.info('Follow-up re-queued for retry', { action: existing.action, leadId: existing.lead_id, callId: existing.call_id });
    return { ok: true, followup: repended };
  } catch (err: any) {
    logger.error('Follow-up retry failed', { error: sanitizeFollowupErrorMessage(err) });
    return { ok: false };
  }
};
