/**
 * Phase 13 – thin Follow-up controller.
 *
 * Validation + HTTP mapping only. All scheduling, policy, execution,
 * retries, and persistence live in `followupService`. Never called from
 * the Vapi/LLM path.
 *
 * NOTE: `POST /followups/execute-due` is an INTERNAL/admin execution
 * endpoint for a future scheduler/worker (cron, queue consumer, or ops
 * tooling). It is not a public API for arbitrary external callers. No
 * authentication infrastructure is added in Phase 13; restrict network
 * access to this endpoint until auth exists.
 */
import { Request, Response, NextFunction } from 'express';
import { FollowupAction, FollowupStatus, isFollowupAction } from '../services/followup/followupTypes';
import {
  cancelFollowup,
  executeDueFollowUps,
  executeFollowupOnce,
  listFollowups,
  retryFollowup,
  scheduleFollowup
} from '../services/followup/followupService';
import { findFollowupById } from '../repositories/followupRepository';
import { WhatsappTemplateName } from '../services/whatsapp/whatsappProvider';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const ALLOWED_TEMPLATES: WhatsappTemplateName[] = [
  'lead_welcome',
  'call_summary_hot',
  'call_summary_warm',
  'call_missed'
];

export const schedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { leadId, callId, action, scheduledAt, template } = req.body || {};
    if (!isNonEmptyString(leadId) && !isNonEmptyString(callId)) {
      return res.status(400).json({
        success: false,
        error: { message: 'leadId or callId is required', code: 400 }
      });
    }
    if (!isNonEmptyString(action) || !isFollowupAction(action)) {
      return res.status(400).json({
        success: false,
        error: { message: 'action must be whatsapp_followup, crm_followup, or missed_reminder', code: 400 }
      });
    }
    if (action === 'whatsapp_followup' && isNonEmptyString(template) && !ALLOWED_TEMPLATES.includes(template as WhatsappTemplateName)) {
      return res.status(400).json({
        success: false,
        error: { message: 'template must be an existing WhatsApp template name', code: 400 }
      });
    }
    const outcome = await scheduleFollowup({
      leadId: isNonEmptyString(leadId) ? leadId : null,
      callId: isNonEmptyString(callId) ? callId : null,
      action: action as FollowupAction,
      scheduledAt: isNonEmptyString(scheduledAt) ? scheduledAt : null,
      template: isNonEmptyString(template) ? (template as WhatsappTemplateName) : null
    });
    if (outcome.ok && outcome.followup) {
      return res
        .status(outcome.created ? 201 : 200)
        .json({ success: true, data: outcome.followup });
    }
    const statusBySkip: Record<string, number> = {
      invalid_action: 400,
      invalid_template: 400,
      no_input: 400,
      tier: 403,
      no_data: 404,
      disabled: 503
    };
    const status = (outcome.skipped && statusBySkip[outcome.skipped]) || 502;
    return res.status(status).json({
      success: false,
      error: { message: `Follow-up not scheduled (${outcome.skipped || 'provider_error'})`, code: status },
      data: outcome.followup || undefined
    });
  } catch (err) {
    next(err);
  }
};

const MAX_LIST_LIMIT = 100;
const FOLLOWUP_STATUSES: readonly string[] = ['pending', 'processing', 'completed', 'failed', 'cancelled'];

/** GET /api/v1/followups — paginated rows, newest first, optional filters. */
export const list = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const errors: string[] = [];
    let page = 1;
    let limit = 20;
    if (query.page !== undefined && query.page !== '') {
      const parsed = Number(query.page);
      if (!Number.isInteger(parsed) || parsed < 1) errors.push('page must be a positive integer');
      else page = parsed;
    }
    if (query.limit !== undefined && query.limit !== '') {
      const parsed = Number(query.limit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIST_LIMIT) {
        errors.push(`limit must be a positive integer between 1 and ${MAX_LIST_LIMIT}`);
      } else limit = parsed;
    }
    if (query.status !== undefined && query.status !== '' && !FOLLOWUP_STATUSES.includes(query.status)) {
      errors.push('status must be pending, processing, completed, failed, or cancelled');
    }
    if (query.action !== undefined && query.action !== '' && !isFollowupAction(query.action)) {
      errors.push('action must be whatsapp_followup, crm_followup, or missed_reminder');
    }
    if (errors.length) {
      return res.status(400).json({ success: false, error: { message: 'Validation error', code: 400, details: errors } });
    }
    const result = await listFollowups({
      status: query.status ? (query.status as FollowupStatus) : undefined,
      leadId: query.leadId || undefined,
      action: query.action ? (query.action as FollowupAction) : undefined,
      page,
      limit
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {

  try {
    const followup = await findFollowupById(req.params.id);
    if (!followup) {
      return res.status(404).json({
        success: false,
        error: { message: 'Follow-up not found', code: 404 }
      });
    }
    return res.json({ success: true, data: followup });
  } catch (err) {
    next(err);
  }
};

/**
 * INTERNAL/admin only: execute due follow-ups. Intended for a future
 * scheduler/worker, not for arbitrary external callers (see module note).
 */
export const executeDue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit } = req.body || {};
    const parsedLimit = typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined;
    const outcome = await executeDueFollowUps({ limit: parsedLimit });
    if (outcome.skipped === 'disabled') {
      return res.status(503).json({
        success: false,
        error: { message: 'Follow-up execution disabled', code: 503 }
      });
    }
    return res.json({ success: true, data: outcome });
  } catch (err) {
    next(err);
  }
};

export const executeOne = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const outcome = await executeFollowupOnce(req.params.id);
    if (outcome.ok && outcome.followup) {
      return res.json({ success: true, data: outcome.followup });
    }
    const statusBySkip: Record<string, number> = {
      not_found: 404,
      already_terminal: 409,
      max_attempts: 409,
      claim_lost: 409,
      not_due: 409,
      disabled: 503
    };
    const status = (outcome.skipped && statusBySkip[outcome.skipped]) || 502;
    return res.status(status).json({
      success: false,
      error: { message: `Follow-up not executed (${outcome.skipped || 'provider_error'})`, code: status },
      data: outcome.followup || undefined
    });
  } catch (err) {
    next(err);
  }
};

export const cancel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const outcome = await cancelFollowup(req.params.id);
    if (outcome.ok && outcome.followup) {
      return res.json({ success: true, data: outcome.followup });
    }
    const statusBySkip: Record<string, number> = {
      not_found: 404,
      already_terminal: 409,
      disabled: 503
    };
    const status = (outcome.skipped && statusBySkip[outcome.skipped]) || 502;
    return res.status(status).json({
      success: false,
      error: { message: `Follow-up not cancelled (${outcome.skipped || 'provider_error'})`, code: status },
      data: outcome.followup || undefined
    });
  } catch (err) {
    next(err);
  }
};

export const retry = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const outcome = await retryFollowup(req.params.id);
    if (outcome.ok && outcome.followup) {
      return res.json({ success: true, data: outcome.followup });
    }
    const statusBySkip: Record<string, number> = {
      not_found: 404,
      not_failed: 409,
      max_attempts: 409,
      disabled: 503
    };
    const status = (outcome.skipped && statusBySkip[outcome.skipped]) || 502;
    return res.status(status).json({
      success: false,
      error: { message: `Follow-up not retried (${outcome.skipped || 'provider_error'})`, code: status },
      data: outcome.followup || undefined
    });
  } catch (err) {
    next(err);
  }
};
