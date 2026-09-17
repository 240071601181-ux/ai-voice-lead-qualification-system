/**
 * Phase 7 — conversation qualification integration fan-out.
 *
 * Connects a persisted conversation qualification to the existing CRM, n8n,
 * WhatsApp, and follow-up infrastructure WITHOUT new frameworks:
 *
 *   conversation → qualification (persisted)
 *     → async fan-out (fire-and-forget, never in the LLM critical path)
 *       → CRM sync + n8n event + WhatsApp summary + follow-up scheduling
 *
 * Hard guarantees (mirroring each provider's own contract):
 * - NEVER in the synchronous path: entry via
 *   `enqueueConversationQualificationFanout` (`setImmediate`). Qualify,
 *   message, and complete handlers never await integration work.
 * - NEVER throws: every provider is error-isolated; one failure cannot fail
 *   the others, the conversation, or roll back the qualification.
 * - NEVER lets the LLM invoke integrations directly: the LLM has no tool
 *   path to any of these services; fan-out runs only on persisted state.
 * - Calendar is deliberately untouched: qualification only makes a
 *   conversation *eligible*; booking still requires an explicit slot
 *   (logistics `required_date` is NOT meeting time).
 * - Consent is never bypassed: the WhatsApp deny-by-default gate stays
 *   inside `whatsappSender`; COLD tiers get no summary and no follow-ups
 *   (existing policy).
 * - Idempotent: conversation-scoped keys + payload-hash no-change skips in
 *   each provider; repeated recalculation does not duplicate side effects.
 */
import { QualificationTier } from '../models/Qualification';
import { enqueueCrmSync } from './crm/crmSyncService';
import { enqueueFollowupScheduling } from './followup/followupService';
import { enqueueN8nEvent } from './n8n/n8nEmitter';
import { enqueueWhatsappMessage } from './whatsapp/whatsappSender';
import { WhatsappTemplateName } from './whatsapp/whatsappProvider';
import { logger } from '../utils/logger';

/**
 * Minimal downstream event. Only what consumers need — no JWTs, API keys,
 * system prompts, or message history.
 */
export interface ConversationQualificationFanoutEvent {
  qualificationId: string;
  conversationId: string;
  leadId: string;
  score: number;
  tier: QualificationTier;
  qualifiedAt: string;
}

export type FanoutProviderName = 'crm' | 'n8n' | 'whatsapp' | 'followup';

export interface FanoutProviderOutcome {
  provider: FanoutProviderName;
  /** 'enqueued' (async tail scheduled) or 'skipped' with a safe reason. */
  status: 'enqueued' | 'skipped';
  reason?: string;
}

export interface ConversationFanoutOutcome {
  outcomes: FanoutProviderOutcome[];
}

const summaryTemplateForTier = (tier: QualificationTier): WhatsappTemplateName | null => {
  if (tier === 'HOT') return 'call_summary_hot';
  if (tier === 'WARM') return 'call_summary_warm';
  return null; // COLD: no summary per existing policy.
};

/**
 * Decide the provider plan synchronously (pure, testable, no I/O).
 * Every provider stays independently gated by its own enabled flag,
 * consent gate, and tier policy at execution time.
 */
export const planConversationQualificationFanout = (
  event: ConversationQualificationFanoutEvent
): FanoutProviderOutcome[] => {
  const template = summaryTemplateForTier(event.tier);
  return [
    { provider: 'crm', status: 'enqueued' },
    { provider: 'n8n', status: 'enqueued' },
    template
      ? { provider: 'whatsapp', status: 'enqueued' }
      : { provider: 'whatsapp', status: 'skipped', reason: 'tier_policy' },
    { provider: 'followup', status: 'enqueued' },
  ];
};

/**
 * Fire-and-forget entry point. Safe to call without awaiting from
 * qualifyConversation. Never throws.
 */
export const enqueueConversationQualificationFanout = (
  event: ConversationQualificationFanoutEvent
): void => {
  try {
    setImmediate(() => {
      runConversationQualificationFanout(event).catch((err: any) => {
        logger.error('Conversation qualification fan-out failed', {
          error: err?.message,
          conversationId: event.conversationId,
          leadId: event.leadId,
          qualificationId: event.qualificationId,
        });
      });
    });
  } catch (err: any) {
    logger.error('Conversation qualification fan-out could not be scheduled', {
      error: err?.message,
      conversationId: event.conversationId,
    });
  }
};

/**
 * Execute one fan-out pass. Each provider is error-isolated: a CRM outage,
 * an n8n failure, or a WhatsApp skip is recorded by that provider's own
 * delivery rows and never fails the others. Resolves, never rejects.
 */
export const runConversationQualificationFanout = async (
  event: ConversationQualificationFanoutEvent
): Promise<ConversationFanoutOutcome> => {
  const outcomes: FanoutProviderOutcome[] = [];
  const tasks: Array<{ provider: FanoutProviderName; run: () => void }> = [
    {
      provider: 'crm',
      run: () =>
        enqueueCrmSync({ leadId: event.leadId, conversationId: event.conversationId }),
    },
    {
      provider: 'n8n',
      run: () =>
        enqueueN8nEvent('qualification.completed', {
          leadId: event.leadId,
          conversationId: event.conversationId,
        }),
    },
    {
      provider: 'whatsapp',
      run: () => {
        const template = summaryTemplateForTier(event.tier);
        if (!template) return;
        enqueueWhatsappMessage({
          template,
          leadId: event.leadId,
          conversationId: event.conversationId,
        });
      },
    },
    {
      provider: 'followup',
      run: () =>
        enqueueFollowupScheduling({ leadId: event.leadId, conversationId: event.conversationId }),
    },
  ];

  const planned = new Map(planConversationQualificationFanout(event).map((p) => [p.provider, p]));
  const results = await Promise.allSettled(
    tasks.map(async ({ provider, run }) => {
      run();
      return provider;
    })
  );
  results.forEach((result, index) => {
    const provider = tasks[index].provider;
    if (result.status === 'fulfilled') {
      outcomes.push(planned.get(provider) ?? { provider, status: 'enqueued' });
    } else {
      logger.error('Conversation qualification fan-out provider failed in isolation', {
        error: (result.reason as Error)?.message,
        conversationId: event.conversationId,
        leadId: event.leadId,
        provider,
      });
      outcomes.push({ provider, status: 'skipped', reason: 'provider_error' });
    }
  });

  logger.info('Conversation qualification fan-out scheduled', {
    conversationId: event.conversationId,
    leadId: event.leadId,
    qualificationId: event.qualificationId,
    tier: event.tier,
    score: event.score,
  });
  return { outcomes };
};
