/**
 * Phase 11 – WhatsApp send orchestrator.
 *
 * Sends vendor-approved template messages to leads after backend events.
 *
 * Hard guarantees:
 * - NEVER in the real-time path: entry via `enqueueWhatsappMessage`
 *   (fire-and-forget `setImmediate`). Callers must not `await` it.
 * - NEVER throws to callers: failures are recorded in `whatsapp_deliveries`
 *   + logs only.
 * - Independent from CRM/n8n: no cross-imports; failure of one cannot
 *   affect the others, call completion, or qualification.
 * - NEVER logs or persists secrets or full phone numbers in error text.
 * - Deny-by-default consent: the repository has no consent source yet, so
 *   when WHATSAPP_REQUIRE_CONSENT is true (default) every send is skipped
 *   with `skipped_no_consent` until a real source is integrated. Setting it
 *   to false is an explicit sandbox-only override.
 * - Idempotent: stable message key per provider+template+anchor; unchanged
 *   re-emissions skip without a provider call (payload hash comparison).
 * - Allowlisted template variables only; no transcripts, scores, or IDs.
 */
import { Lead } from '../../models/lead';
import { LeadService } from '../leadService';
import { findCallById } from '../../repositories/callRepository';
import { findConversationById } from '../../repositories/conversationRepository';
import { findConversationStateByConversationId } from '../../repositories/conversationStatesRepository';
import { getStateByCallId } from '../conversationStateService';
import {
  findQualificationByCallId,
  findQualificationByConversationId,
} from '../../repositories/qualificationRepository';
import {
  buildWhatsappMessageKey,
  getWhatsappProvider,
  hashWhatsappPayload,
  WhatsappTemplateName
} from './whatsappProvider';
import { resolveTemplateContentSid } from './whatsappTemplates';
import {
  buildWhatsappPayload,
  hasMeaningfulContact,
  resolveWhatsappLanguage
} from './whatsappMessageBuilder';
import { withCrmRetry } from '../crm/crmRetry';
import {
  findDeliveryByMessageKey,
  markDeliveryDelivered,
  markDeliveryFailed,
  markDeliverySkipped,
  upsertDeliveryAttempt
} from '../../repositories/whatsappDeliveryRepository';
import { getWhatsappConfig, isWhatsappEnabled } from '../../config';
import { logger } from '../../utils/logger';

export interface WhatsappEnqueueInput {
  template: WhatsappTemplateName;
  leadId?: string | null;
  callId?: string | null;
  /** Phase 7: text-conversation anchor (trusted conversationId, never a fake callId). */
  conversationId?: string | null;
}

export interface WhatsappSendOutcome {
  ok: boolean;
  skipped?:
    | 'disabled'
    | 'no_input'
    | 'no_data'
    | 'no_config'
    | 'no_phone'
    | 'no_consent'
    | 'no_template'
    | 'suppressed'
    | 'no_changes';
}

/**
 * Consent evidence for a lead.
 *
 * The repository currently has NO consent source (no opt-in field on leads,
 * no intake flag), so this always returns 'unknown' — and with the default
 * WHATSAPP_REQUIRE_CONSENT=true every send is skipped. This function is the
 * single extension point: when a real source is integrated, return
 * 'opted_in' here without touching any other logic.
 */
export const resolveWhatsappConsent = (_lead: Lead | null): 'opted_in' | 'unknown' => {
  return 'unknown';
};

/** Remove secrets/tokens/numbers from error text before logging or persisting. */
export const sanitizeWhatsappErrorMessage = (err: any): string => {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown WhatsApp error');
  const cfg = getWhatsappConfigSafe();
  let clean = raw;
  for (const secret of [cfg.authToken, cfg.accountSid]) {
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

const getWhatsappConfigSafe = (): { authToken: string; accountSid: string } => {
  try {
    const cfg = getWhatsappConfig();
    return { authToken: cfg.authToken || '', accountSid: cfg.accountSid || '' };
  } catch {
    return { authToken: '', accountSid: '' };
  }
};

const leadService = new LeadService();

/**
 * Fire-and-forget entry point. Safe to call without awaiting from async
 * tails. Never throws.
 */
export const enqueueWhatsappMessage = (input: WhatsappEnqueueInput): void => {
  if (!isWhatsappEnabled()) return;
  setImmediate(() => {
    sendWhatsappOnce(input).catch((err: any) => {
      logger.error('WhatsApp send failed', {
        error: sanitizeWhatsappErrorMessage(err),
        template: input.template,
        leadId: input.leadId || null,
        callId: input.callId || null,
        conversationId: input.conversationId || null
      });
    });
  });
};

/**
 * Single send attempt. Resolves (never rejects) with an outcome summary.
 */
export const sendWhatsappOnce = async (
  input: WhatsappEnqueueInput
): Promise<WhatsappSendOutcome> => {
  if (!isWhatsappEnabled()) return { ok: false, skipped: 'disabled' };
  const callId = input.callId || null;
  const conversationId = input.conversationId || null;
  const inputLeadId = input.leadId || null;
  if (!callId && !inputLeadId && !conversationId) {
    logger.warn('WhatsApp send skipped: no callId, leadId, or conversationId provided', {
      template: input.template
    });
    return { ok: false, skipped: 'no_input' };
  }

  const cfg = getWhatsappConfig();
  if (!cfg.fromNumber) {
    logger.warn('WhatsApp send skipped: WHATSAPP_FROM_NUMBER not configured', {
      template: input.template
    });
    return { ok: false, skipped: 'no_config' };
  }

  try {
    // Reuse existing Phase 1–10 readers only; no duplicated business logic.
    // Conversation path reads conversation state + qualification by
    // conversationId; the legacy path reads by callId exactly as before.
    const [call, state, qualification] = await Promise.all([
      callId ? findCallById(callId) : Promise.resolve(null),
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
      inputLeadId || state?.lead_id || call?.lead_id || qualification?.lead_id || null;
    const lead = leadId ? await leadService.getLead(leadId) : null;

    if (!lead && !call && !state && !qualification) {
      logger.warn('WhatsApp send skipped: no lead/call/state/qualification data found', {
        template: input.template,
        leadId,
        callId,
        conversationId
      });
      return { ok: false, skipped: 'no_data' };
    }

    // Template-specific suppression from existing data only (no new detection logic).
    if (input.template === 'call_missed' && hasMeaningfulContact(state as any)) {
      return { ok: false, skipped: 'suppressed' };
    }
    if (
      (input.template === 'call_summary_hot' || input.template === 'call_summary_warm') &&
      qualification &&
      ((input.template === 'call_summary_hot' && qualification.tier !== 'HOT') ||
        (input.template === 'call_summary_warm' && qualification.tier !== 'WARM'))
    ) {
      return { ok: false, skipped: 'suppressed' };
    }

    // Deny-by-default consent gate (no consent source exists yet).
    if (cfg.requireConsent && resolveWhatsappConsent(lead) !== 'opted_in') {
      const providerName = safeProviderName();
      const anchor = conversationId || callId || (leadId as string);
      const row = await upsertDeliveryAttempt({
        template: input.template,
        message_key: buildWhatsappMessageKey(providerName, input.template, anchor),
        lead_id: leadId,
        call_id: callId,
        qualification_id: qualification?.id || null,
        provider: providerName,
        language: cfg.defaultLanguage,
        payload_hash: 'no-consent'
      });
      await markDeliverySkipped(row.id, 'skipped_no_consent');
      logger.info('WhatsApp send skipped: explicit consent unavailable', {
        template: input.template,
        leadId,
        callId,
        conversationId
      });
      return { ok: false, skipped: 'no_consent' };
    }

    const provider = getWhatsappProvider();
    const language = resolveWhatsappLanguage({ globalDefaultLanguage: cfg.defaultLanguage });
    const contentSid = resolveTemplateContentSid(cfg.templateSids, input.template, language);
    if (!contentSid) {
      logger.warn('WhatsApp send skipped: template content SID not configured', {
        template: input.template
      });
      return { ok: false, skipped: 'no_template' };
    }

    const payload = buildWhatsappPayload({
      lead,
      state: state as any,
      template: input.template,
      contentSid,
      globalDefaultLanguage: cfg.defaultLanguage
    });
    if (!payload) {
      const providerName = provider.name;
      const anchor = conversationId || callId || (leadId as string);
      const row = await upsertDeliveryAttempt({
        template: input.template,
        message_key: buildWhatsappMessageKey(providerName, input.template, anchor),
        lead_id: leadId,
        call_id: callId,
        qualification_id: qualification?.id || null,
        provider: providerName,
        language: cfg.defaultLanguage,
        payload_hash: 'no-phone'
      });
      await markDeliverySkipped(row.id, 'skipped_no_phone');
      return { ok: false, skipped: 'no_phone' };
    }

    const anchor =
      conversationId || call?.id || (state as any)?.call_id || qualification?.call_id || (leadId as string);
    const messageKey = buildWhatsappMessageKey(provider.name, input.template, anchor);
    const payloadHash = hashWhatsappPayload(payload);

    const previous = await findDeliveryByMessageKey(messageKey);
    const row = await upsertDeliveryAttempt({
      template: input.template,
      message_key: messageKey,
      lead_id: leadId,
      call_id: callId,
      qualification_id: qualification?.id || null,
      provider: provider.name,
      language: payload.language,
      payload_hash: payloadHash
    });

    if (
      previous &&
      (previous.status === 'delivered' || previous.status === 'skipped_no_changes') &&
      previous.payload_hash === payloadHash
    ) {
      await markDeliverySkipped(row.id, 'skipped_no_changes');
      logger.info('WhatsApp send skipped: payload unchanged', {
        template: input.template,
        leadId,
        callId,
        conversationId
      });
      return { ok: true, skipped: 'no_changes' };
    }

    const result = await withCrmRetry(
      () => provider.sendTemplate(payload, { idempotencyKey: messageKey, timeoutMs: cfg.timeoutMs }),
      { maxRetries: cfg.maxRetries, baseDelayMs: cfg.baseDelayMs }
    );

    await markDeliveryDelivered(row.id, result.providerMessageId);
    logger.info('WhatsApp send completed', {
      template: input.template,
      leadId,
      callId,
      conversationId
    });
    return { ok: true };
  } catch (err: any) {
    const message = sanitizeWhatsappErrorMessage(err);
    try {
      const providerName = safeProviderName();
      const anchor = conversationId || callId || inputLeadId || 'unknown';
      const failedRow = await upsertDeliveryAttempt({
        template: input.template,
        message_key: buildWhatsappMessageKey(providerName, input.template, anchor),
        lead_id: inputLeadId,
        call_id: callId,
        qualification_id: null,
        provider: providerName,
        language: getWhatsappConfig().defaultLanguage,
        payload_hash: 'error'
      });
      await markDeliveryFailed(failedRow.id, message);
    } catch (persistErr: any) {
      logger.error('WhatsApp failure could not be persisted', {
        error: sanitizeWhatsappErrorMessage(persistErr)
      });
    }
    logger.error('WhatsApp send failed', {
      error: message,
      template: input.template,
      leadId: inputLeadId,
      callId,
      conversationId
    });
    return { ok: false };
  }
};

const safeProviderName = (): string => {
  try {
    return getWhatsappProvider().name;
  } catch {
    return getWhatsappConfig().provider || 'twilio';
  }
};
