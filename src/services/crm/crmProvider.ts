/**
 * Phase 9 – CRM provider abstraction.
 *
 * Provider-independent contract for CRM contact synchronization.
 * All CRM I/O goes through `CrmProvider`; callers (sync service) never
 * touch HTTP or provider-specific details directly.
 *
 * Constraints enforced by design:
 * - CRM logic lives in services/integration layers only (never controllers/repositories/LLM).
 * - HOT/WARM/COLD tier is a direct passthrough from Phase 8 (no AI qualification here).
 * - Credentials never appear in logs (see sanitizeCrmErrorMessage in crmSyncService).
 */

export type CrmQualificationTier = 'HOT' | 'WARM' | 'COLD';

/** Provider-neutral contact payload built by crmMapper (missing data omitted, never inferred). */
export interface CrmContactPayload {
  external_lead_id?: string | null;
  external_call_id?: string | null;
  /** Phase 7: conversation anchor for text qualifications (no fake callId). */
  external_conversation_id?: string | null;
  vapi_call_id?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  lead_source?: string | null;
  customer_name?: string | null;
  origin?: string | null;
  destination?: string | null;
  route?: string | null;
  vehicle_type?: string | null;
  cargo_type?: string | null;
  cargo_weight?: number | null;
  cargo_dimensions?: string | null;
  required_date?: string | null;
  budget?: number | null;
  urgency?: string | null;
  booking_intent?: string | null;
  additional_requirements?: string | null;
  last_call_started_at?: string | null;
  last_call_ended_at?: string | null;
  last_call_duration_seconds?: number | null;
  last_call_status?: string | null;
  qualification_score?: number | null;
  /** Direct passthrough of the Phase 8 deterministic tier. */
  qualification_tier?: CrmQualificationTier | null;
  qualified_at?: string | null;
  qualification_details?: unknown;
}

export interface CrmUpsertOptions {
  /** Stable key `crm:{provider}:{call_id|lead_id}`; sent as Idempotency-Key header. */
  idempotencyKey: string;
  timeoutMs: number;
  /** Known CRM-side contact id from a previous successful sync (update path). */
  crmContactId?: string | null;
}

export interface CrmSyncResult {
  crmContactId: string;
  created: boolean;
}

export interface CrmProvider {
  readonly name: string;
  upsertContact(payload: CrmContactPayload, opts: CrmUpsertOptions): Promise<CrmSyncResult>;
}

export const buildCrmIdempotencyKey = (
  providerName: string,
  callId?: string | null,
  leadId?: string | null,
  conversationId?: string | null
): string => {
  // Phase 7: conversation-scoped keys keep text syncs independent per
  // conversation; legacy call/lead keys are byte-identical to before.
  const anchor = conversationId ? `conv:${conversationId}` : callId || leadId || 'unknown';
  return `crm:${providerName}:${anchor}`;
};

/** Stable sha256 hash of the canonical payload for no-change skipping. */
export const hashCrmPayload = (payload: CrmContactPayload): string => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('crypto') as typeof import('crypto');
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(canonical).digest('hex');
};

let testOverride: CrmProvider | null = null;

/** Test-only hook: inject a fake provider without touching env. */
export const setCrmProviderForTests = (provider: CrmProvider | null): void => {
  testOverride = provider;
};

export const resetCrmProviderForTests = (): void => {
  testOverride = null;
};

/** Resolve the configured provider. Replaceable: add a file implementing CrmProvider. */
export const getCrmProvider = (): CrmProvider => {
  if (testOverride) return testOverride;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getCrmConfig } = require('../../config') as typeof import('../../config');
  const providerName = (getCrmConfig().provider || 'http').toLowerCase();
  if (providerName === 'mock') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MockCrmProvider } = require('./mockCrmProvider') as typeof import('./mockCrmProvider');
    return new MockCrmProvider();
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { HttpCrmProvider } = require('./httpCrmProvider') as typeof import('./httpCrmProvider');
  return new HttpCrmProvider();
};
