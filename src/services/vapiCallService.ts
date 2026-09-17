/**
 * PHASE 14C-VOICE-1 – Real Vapi outbound call initiation (backend only).
 *
 * Mechanism (per official Vapi docs, "Outbound Calling" + quickstart):
 *   POST {VAPI_BASE_URL}/call
 *   Authorization: Bearer <VAPI_API_KEY>
 *   { "assistantId": "...", "phoneNumberId": "...",
 *     "customer": { "number": "<E.164>" } }
 * Responds 201 with `{ id, status: "queued", ... }`; `id` is the Vapi call ID.
 *
 * Flow: resolve the lead's phone server-side -> create the Vapi call ->
 * persist the Vapi call id via the EXISTING calls lifecycle
 * (`upsertCall`, status 'initiated'). Later Vapi webhooks
 * (call.initiated/answered/ended) update the same row, feeding the existing
 * conversation-state / qualification / follow-up pipeline unchanged.
 *
 * Security: VAPI_API_KEY never leaves this service (Authorization header
 * only). Provider errors are logged server-side and re-thrown with sanitized
 * messages so no secret or provider internals reach API responses.
 */
import axios from 'axios';
import { getVapiConfig } from '../config';
import { leadRepository } from '../repositories/leadRepository';
import { upsertCall, findActiveCallByLeadId } from '../repositories/callRepository';
import { Call } from '../models/Call';
import { logger } from '../utils/logger';

export interface StartOutboundCallInput {
  leadId: string;
}

export interface StartOutboundCallResult {
  /** Persisted internal calls row (status 'initiated'). */
  call: Call;
  /** Real Vapi call id returned by POST /call. */
  vapiCallId: string;
  /** Raw status returned by Vapi (typically "queued"). */
  vapiStatus: string;
}

/**
 * User-facing signal for unavailable outbound telephony: no usable
 * assistant/phone-number (or provider rejects our credentials/numbers).
 * Never faked as success — always surfaces as a 503 failure.
 */
export const TELEPHONY_NOT_CONFIGURED_MESSAGE =
  'Voice calling is not configured. Add a supported Vapi/Twilio phone number to place outbound calls.';

/** Replaceable Vapi HTTP boundary (mocked in tests; axios in production). */
export interface VapiCallHttpClient {
  createCall(args: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
    body: Record<string, unknown>;
  }): Promise<{ id?: string; status?: string }>;
}

class AxiosVapiCallHttpClient implements VapiCallHttpClient {
  async createCall(args: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
    body: Record<string, unknown>;
  }): Promise<{ id?: string; status?: string }> {
    const res = await axios.post(`${args.baseUrl}/call`, args.body, {
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: args.timeoutMs
    });
    return { id: res.data?.id, status: res.data?.status };
  }
}

let httpClient: VapiCallHttpClient = new AxiosVapiCallHttpClient();

export const setVapiCallHttpClientForTests = (client: VapiCallHttpClient): void => {
  httpClient = client;
};

export const resetVapiCallHttpClientForTests = (): void => {
  httpClient = new AxiosVapiCallHttpClient();
};

/** Normalize to E.164 (`+` + 8-15 digits); null when missing/invalid. */
export const normalizePhoneToE164 = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s\-().]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null;
};

const httpError = (status: number, message: string): any => {
  const err: any = new Error(message);
  err.status = status;
  // Explicit marker: HTTP-client libraries (axios v1 exposes .status too)
  // must never be mistaken for these intentional, sanitized errors.
  err.isStartCallHttpError = true;
  return err;
};

export const startOutboundCall = async (input: StartOutboundCallInput): Promise<StartOutboundCallResult> => {
  const leadId = typeof input?.leadId === 'string' ? input.leadId.trim() : '';
  if (!leadId) {
    throw httpError(400, 'leadId is required');
  }

  const lead = await leadRepository.findById(leadId);
  if (!lead) {
    throw httpError(404, 'Lead not found');
  }

  const customerNumber = normalizePhoneToE164(lead.phone);
  if (!customerNumber) {
    throw httpError(422, 'Lead has no valid phone number for calling');
  }

  const active = await findActiveCallByLeadId(lead.id);
  if (active) {
    const err: any = httpError(409, 'A call is already in progress for this lead');
    err.details = { callId: active.id, vapiCallId: active.vapi_call_id, status: active.status };
    throw err;
  }

  const cfg = getVapiConfig();
  if (!cfg.apiKey || !cfg.assistantId || !cfg.phoneNumberId) {
    throw httpError(503, TELEPHONY_NOT_CONFIGURED_MESSAGE);
  }

  let vapiCallId: string | undefined;
  let vapiStatus = 'queued';
  try {
    const created = await httpClient.createCall({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      timeoutMs: cfg.timeoutMs,
      body: {
        assistantId: cfg.assistantId,
        phoneNumberId: cfg.phoneNumberId,
        customer: { number: customerNumber, name: lead.name },
        assistantOverrides: {
          variableValues: { leadId: lead.id, leadName: lead.name }
        }
      }
    });
    vapiCallId = created?.id;
    if (typeof created?.status === 'string' && created.status.length > 0) {
      vapiStatus = created.status;
    }
    if (!vapiCallId) {
      throw new Error('Vapi call creation returned no call id');
    }
  } catch (err: any) {
    // Preserve intentional HTTP errors; sanitize provider failures (never
    // leak provider messages/statuses — HTTP clients expose .status too).
    if (err?.isStartCallHttpError) throw err;
    const vapiStatusCode = err?.response?.status;
    logger.error('Vapi outbound call creation failed', {
      leadId: lead.id,
      vapiStatusCode
    });
    // The provider rejected our request (bad key, unknown/unprovisioned
    // assistant or phone-number IDs): no usable outbound telephony, same
    // truthful signal as missing configuration. Anything else (5xx,
    // network) is a provider-side failure.
    if (
      typeof vapiStatusCode === 'number' &&
      [400, 401, 403].includes(vapiStatusCode)
    ) {
      throw httpError(503, TELEPHONY_NOT_CONFIGURED_MESSAGE);
    }
    throw httpError(502, 'Voice provider rejected the call request');
  }

  // Persist via the existing lifecycle model only (no duplicated logic).
  // Local status stays 'initiated' so the existing webhook handlers
  // (initiated -> answered -> ended) transition this same row.
  const call = await upsertCall({
    vapi_call_id: vapiCallId,
    lead_id: lead.id,
    status: 'initiated',
    started_at: new Date().toISOString()
  });

  return { call, vapiCallId, vapiStatus };
};
