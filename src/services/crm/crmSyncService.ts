/**
 * Phase 9 – CRM synchronization orchestrator.
 *
 * Gathers existing Phase 1–8 data (lead, call, conversation state,
 * qualification), maps it to a provider-neutral payload, and pushes it to
 * the configured CRM provider with bounded retries.
 *
 * Hard guarantees:
 * - NEVER throws to callers: failures are recorded in `crm_syncs` + logs only.
 * - NEVER blocks Vapi/call completion/qualification: entry via `enqueueCrmSync`
 *   (fire-and-forget `setImmediate`). Callers must not `await` it.
 * - NEVER logs credentials or sensitive error data (sanitized messages only).
 * - Idempotent: stable idempotency key per provider+call; unchanged payloads
 *   are skipped without a provider call (payload hash comparison).
 * - Tier is a direct passthrough from Phase 8; no AI qualification here.
 */
import { LeadService } from '../leadService';
import { findCallById } from '../../repositories/callRepository';
import { findConversationById } from '../../repositories/conversationRepository';
import { findConversationStateByConversationId } from '../../repositories/conversationStatesRepository';
import { getStateByCallId } from '../conversationStateService';
import {
  findQualificationByCallId,
  findQualificationByConversationId,
} from '../../repositories/qualificationRepository';
import { toCrmContactPayload } from './crmMapper';
import { buildCrmIdempotencyKey, getCrmProvider, hashCrmPayload } from './crmProvider';
import { withCrmRetry } from './crmRetry';
import {
  findSyncByIdempotencyKey,
  markSyncFailed,
  markSyncSkipped,
  markSyncSuccess,
  upsertSyncAttempt
} from '../../repositories/crmSyncRepository';
import { getCrmConfig, isCrmEnabled } from '../../config';
import { logger } from '../../utils/logger';
import { enqueueN8nEvent } from '../n8n/n8nEmitter';

export interface CrmEnqueueInput {
  leadId?: string | null;
  callId?: string | null;
  /** Phase 7: text-conversation anchor (trusted conversationId, never a fake callId). */
  conversationId?: string | null;
}

export interface CrmSyncOutcome {
  ok: boolean;
  skipped?: 'disabled' | 'no_input' | 'no_data' | 'no_changes' | 'no_config';
  attempts?: number;
}

/** Remove credentials/tokens/URLs from any error text before logging or persisting. */
export const sanitizeCrmErrorMessage = (err: any): string => {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown CRM error');
  const cfgApiKey = getCrmConfigSafeApiKey();
  let clean = raw;
  if (cfgApiKey && cfgApiKey.length > 0) {
    clean = clean.split(cfgApiKey).join('[REDACTED]');
  }
  clean = clean
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/g, 'Bearer [REDACTED]')
    .replace(/api[_-]?key\s*[:=]\s*['"]?[^'"\s,}]+['"]?/gi, 'api_key=[REDACTED]')
    .replace(/token\s*[:=]\s*['"]?[^'"\s,}]+['"]?/gi, 'token=[REDACTED]');
  if (clean.length > 500) clean = clean.slice(0, 500);
  return clean;
};

const getCrmConfigSafeApiKey = (): string => {
  try {
    return getCrmConfig().apiKey || '';
  } catch {
    return '';
  }
};

const leadService = new LeadService();

/**
 * Fire-and-forget entry point. Safe to call without awaiting from the
 * post-qualification async tail. Never throws.
 */
export const enqueueCrmSync = (input: CrmEnqueueInput): void => {
  if (!isCrmEnabled()) return;
  setImmediate(() => {
    syncCrmContactOnce(input).catch((err: any) => {
      logger.error('CRM sync failed', {
        error: sanitizeCrmErrorMessage(err),
        leadId: input.leadId || null,
        callId: input.callId || null,
        conversationId: input.conversationId || null
      });
    });
  });
};

/**
 * Single sync attempt. Resolves (never rejects) with an outcome summary.
 * DB/persistence errors are also contained and reported as failed outcomes.
 */
export const syncCrmContactOnce = async (input: CrmEnqueueInput): Promise<CrmSyncOutcome> => {
  if (!isCrmEnabled()) return { ok: false, skipped: 'disabled' };
  const callId = input.callId || null;
  const conversationId = input.conversationId || null;
  const inputLeadId = input.leadId || null;
  if (!callId && !inputLeadId && !conversationId) {
    logger.warn('CRM sync skipped: no callId, leadId, or conversationId provided');
    return { ok: false, skipped: 'no_input' };
  }

  const cfg = getCrmConfig();
  if (!cfg.baseUrl || !cfg.apiKey) {
    logger.warn('CRM sync skipped: CRM_BASE_URL/CRM_API_KEY not configured');
    return { ok: false, skipped: 'no_config' };
  }

  try {
    // Reuse existing Phase 1–8 readers only; no duplicated business logic.
    // Conversation path reads conversation state + qualification by
    // conversationId; the legacy path reads by callId exactly as before.
    const [call, conversation, state, qualification] = await Promise.all([
      callId ? findCallById(callId) : Promise.resolve(null),
      conversationId ? findConversationById(conversationId) : Promise.resolve(null),
      conversationId
        ? findConversationStateByConversationId(conversationId)
        : callId
          ? getStateByCallId(callId)
          : Promise.resolve(null),
      conversationId
        ? findQualificationByConversationId(conversationId)
        : callId
          ? findQualificationByCallId(callId)
          : Promise.resolve(null)
    ]);
    const leadId =
      inputLeadId ||
      state?.lead_id ||
      call?.lead_id ||
      qualification?.lead_id ||
      conversation?.lead_id ||
      null;
    const lead = leadId ? await leadService.getLead(leadId) : null;

    if (!lead && !call && !state && !qualification && !conversation) {
      logger.warn('CRM sync skipped: no lead/call/state/qualification/conversation data found', {
        leadId,
        callId,
        conversationId
      });
      return { ok: false, skipped: 'no_data' };
    }

    const provider = getCrmProvider();
    const payload = toCrmContactPayload({
      lead,
      call,
      state: state as any,
      qualification,
      conversation: conversationId
        ? { id: conversationId, channel: conversation?.channel ?? null }
        : null
    });
    const idempotencyKey = buildCrmIdempotencyKey(provider.name, callId, leadId, conversationId);
    const payloadHash = hashCrmPayload(payload);

    const previous = await findSyncByIdempotencyKey(idempotencyKey);
    const row = await upsertSyncAttempt({
      provider: provider.name,
      lead_id: leadId,
      call_id: callId,
      qualification_id: qualification?.id || null,
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash
    });

    // No-change skip: last terminal state was success/skipped with identical payload.
    if (
      previous &&
      (previous.status === 'success' || previous.status === 'skipped_no_changes') &&
      previous.payload_hash === payloadHash
    ) {
      await markSyncSkipped(row.id);
      logger.info('CRM sync skipped: payload unchanged', { leadId, callId, conversationId });
      // Phase 10: terminal outcome (skip) is also worth fanning out.
      enqueueN8nEvent('crm_sync.completed', {
        leadId,
        callId,
        crm: { provider: provider.name, crm_contact_id: previous?.crm_contact_id || null, ok: true, skipped: 'no_changes' }
      });
      return { ok: true, skipped: 'no_changes', attempts: row.attempts };
    }

    const result = await withCrmRetry(
      () =>
        provider.upsertContact(payload, {
          idempotencyKey,
          timeoutMs: cfg.timeoutMs,
          crmContactId: previous?.crm_contact_id || row.crm_contact_id || null
        }),
      { maxRetries: cfg.maxRetries, baseDelayMs: cfg.baseDelayMs }
    );

    await markSyncSuccess(row.id, result.crmContactId);
    logger.info('CRM sync completed', {
      leadId,
      callId,
      conversationId,
      crmContactId: result.crmContactId,
      created: result.created
    });
    // Phase 10: notify n8n of the terminal CRM outcome (sibling tail;
    // fire-and-forget, cannot fail this sync which already succeeded).
    enqueueN8nEvent('crm_sync.completed', {
      leadId,
      callId,
      crm: { provider: provider.name, crm_contact_id: result.crmContactId, ok: true, skipped: null }
    });
    return { ok: true, attempts: row.attempts };
  } catch (err: any) {
    const message = sanitizeCrmErrorMessage(err);
    try {
      const providerName = safeProviderName();
      const idempotencyKey = buildCrmIdempotencyKey(providerName, callId, inputLeadId, conversationId);
      const failedRow = await upsertSyncAttempt({
        provider: providerName,
        lead_id: inputLeadId,
        call_id: callId,
        qualification_id: null,
        idempotency_key: idempotencyKey,
        payload_hash: 'error'
      });
      await markSyncFailed(failedRow.id, message);
    } catch (persistErr: any) {
      logger.error('CRM sync failure could not be persisted', {
        error: sanitizeCrmErrorMessage(persistErr)
      });
    }
    logger.error('CRM sync failed', {
      error: message,
      leadId: inputLeadId,
      callId,
      conversationId
    });
    // Phase 10: notify n8n of the terminal CRM failure (fire-and-forget).
    enqueueN8nEvent('crm_sync.completed', {
      leadId: inputLeadId,
      callId,
      crm: { provider: safeProviderName(), crm_contact_id: null, ok: false, skipped: null }
    });
    return { ok: false };
  }
};

const safeProviderName = (): string => {
  try {
    return getCrmProvider().name;
  } catch {
    return getCrmConfig().provider || 'http';
  }
};
