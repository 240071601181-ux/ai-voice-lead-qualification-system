// Configuration loader
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const numberOr = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  // Add other config getters as needed
};

export interface CrmConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  apiKey: string;
  upsertPath: string;
  updatePath: string;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
}

export const getCrmConfig = (): CrmConfig => ({
  enabled: (process.env.CRM_SYNC_ENABLED || 'false').toLowerCase() === 'true',
  provider: process.env.CRM_PROVIDER || 'http',
  baseUrl: process.env.CRM_BASE_URL || '',
  apiKey: process.env.CRM_API_KEY || '',
  upsertPath: process.env.CRM_CONTACT_UPSERT_PATH || '/contacts/upsert',
  updatePath: process.env.CRM_CONTACT_UPDATE_PATH || '/contacts',
  timeoutMs: numberOr(process.env.CRM_TIMEOUT_MS, 8000),
  maxRetries: numberOr(process.env.CRM_MAX_RETRIES, 3),
  baseDelayMs: numberOr(process.env.CRM_RETRY_BASE_DELAY_MS, 500)
});

export const isCrmEnabled = (): boolean => getCrmConfig().enabled;

export interface N8nWorkflowTarget {
  name: string;
  url: string;
}

export interface N8nConfig {
  enabled: boolean;
  webhookSecret: string;
  apiKey: string;
  workflows: Partial<Record<string, N8nWorkflowTarget[]>>;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  allowHttpLocal: boolean;
}

const parseN8nWorkflows = (): Partial<Record<string, N8nWorkflowTarget[]>> => {
  const raw = process.env.N8N_WORKFLOWS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, Array<{ name: string; url: string }>>;
      const out: Partial<Record<string, N8nWorkflowTarget[]>> = {};
      for (const [event, targets] of Object.entries(parsed)) {
        if (Array.isArray(targets)) {
          out[event] = targets
            .filter((t) => t && typeof t.url === 'string' && t.url.length > 0)
            .map((t) => ({ name: String(t.name || t.url), url: t.url }));
        }
      }
      return out;
    } catch {
      // Fall through to per-event URL vars below.
    }
  }
  // Simple alternative: one webhook URL per event via N8N_<EVENT>_WEBHOOK_URL.
  const single = process.env.N8N_WEBHOOK_URL;
  if (single) {
    const target = { name: 'default', url: single };
    return {
      'lead.created': [target],
      'lead.updated': [target],
      'call.completed': [target],
      'qualification.completed': [target],
      'crm_sync.completed': [target]
    };
  }
  return {};
};

export const getN8nConfig = (): N8nConfig => ({
  enabled: (process.env.N8N_ENABLED || 'false').toLowerCase() === 'true',
  webhookSecret: process.env.N8N_WEBHOOK_SECRET || '',
  apiKey: process.env.N8N_API_KEY || '',
  workflows: parseN8nWorkflows(),
  timeoutMs: numberOr(process.env.N8N_TIMEOUT_MS, 8000),
  maxRetries: numberOr(process.env.N8N_MAX_RETRIES, 3),
  baseDelayMs: numberOr(process.env.N8N_RETRY_BASE_DELAY_MS, 500),
  allowHttpLocal: (process.env.N8N_ALLOW_HTTP_LOCAL || 'false').toLowerCase() === 'true'
});

export const isN8nEnabled = (): boolean => getN8nConfig().enabled;

export interface WhatsappConfig {
  enabled: boolean;
  provider: string;
  accountSid: string;
  authToken: string;
  fromNumber: string;
  defaultLanguage: string;
  /** Deny-by-default: no consent source exists yet, so sends are skipped unless explicitly overridden (sandbox-only). */
  requireConsent: boolean;
  templateSids: Record<string, string>;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
}

const parseWhatsappTemplateSids = (): Record<string, string> => {
  const raw = process.env.WHATSAPP_TEMPLATES_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.trim().length > 0) out[key] = value.trim();
      }
      return out;
    } catch {
      return {};
    }
  }
  return {};
};

export const getWhatsappConfig = (): WhatsappConfig => ({
  enabled: (process.env.WHATSAPP_ENABLED || 'false').toLowerCase() === 'true',
  provider: process.env.WHATSAPP_PROVIDER || 'twilio',
  accountSid: process.env.WHATSAPP_ACCOUNT_SID || '',
  authToken: process.env.WHATSAPP_AUTH_TOKEN || '',
  fromNumber: process.env.WHATSAPP_FROM_NUMBER || '',
  defaultLanguage: process.env.WHATSAPP_DEFAULT_LANGUAGE || 'en',
  requireConsent: (process.env.WHATSAPP_REQUIRE_CONSENT || 'true').toLowerCase() === 'true',
  templateSids: parseWhatsappTemplateSids(),
  timeoutMs: numberOr(process.env.WHATSAPP_TIMEOUT_MS, 8000),
  maxRetries: numberOr(process.env.WHATSAPP_MAX_RETRIES, 3),
  baseDelayMs: numberOr(process.env.WHATSAPP_RETRY_BASE_DELAY_MS, 500)
});

export const isWhatsappEnabled = (): boolean => getWhatsappConfig().enabled;

export interface CalendarConfig {
  enabled: boolean;
  provider: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
  timezone: string;
  /** Tiers eligible for booking (COLD never books in Phase 12). */
  autoBookTiers: string[];
  minDurationMin: number;
  maxDurationMin: number;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
}

const parseTierList = (raw: string | undefined, fallback: string[]): string[] => {
  if (!raw) return fallback;
  const tiers = raw
    .split(',')
    .map((tier) => tier.trim().toUpperCase())
    .filter((tier) => tier.length > 0);
  return tiers.length > 0 ? tiers : fallback;
};

export const getCalendarConfig = (): CalendarConfig => ({
  enabled: (process.env.CALENDAR_ENABLED || 'false').toLowerCase() === 'true',
  provider: process.env.CALENDAR_PROVIDER || 'google',
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
  calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
  timezone: process.env.CALENDAR_TIMEZONE || 'Asia/Kolkata',
  autoBookTiers: parseTierList(process.env.CALENDAR_AUTO_BOOK_TIERS, ['HOT', 'WARM']),
  minDurationMin: numberOr(process.env.CALENDAR_MIN_DURATION_MIN, 15),
  maxDurationMin: numberOr(process.env.CALENDAR_MAX_DURATION_MIN, 120),
  timeoutMs: numberOr(process.env.CALENDAR_TIMEOUT_MS, 8000),
  maxRetries: numberOr(process.env.CALENDAR_MAX_RETRIES, 3),
  baseDelayMs: numberOr(process.env.CALENDAR_RETRY_BASE_DELAY_MS, 500)
});

export const isCalendarEnabled = (): boolean => getCalendarConfig().enabled;

export interface FollowupConfig {
  enabled: boolean;
  /** Minutes after the event when a HOT WhatsApp follow-up becomes due. */
  hotDelayMin: number;
  /** Minutes after the event when a WARM WhatsApp follow-up becomes due. */
  warmDelayMin: number;
  /** Minutes after the event when a CRM follow-up becomes due (all tiers). */
  crmDelayMin: number;
  maxAttempts: number;
  maxRetries: number;
  baseDelayMs: number;
  executeLimit: number;
  processingTimeoutMs: number;
}

export const getFollowupConfig = (): FollowupConfig => ({
  enabled: (process.env.FOLLOWUP_ENABLED || 'false').toLowerCase() === 'true',
  hotDelayMin: numberOr(process.env.FOLLOWUP_HOT_DELAY_MIN, 30),
  warmDelayMin: numberOr(process.env.FOLLOWUP_WARM_DELAY_MIN, 240),
  crmDelayMin: numberOr(process.env.FOLLOWUP_CRM_DELAY_MIN, 60),
  maxAttempts: numberOr(process.env.FOLLOWUP_MAX_ATTEMPTS, 5),
  maxRetries: numberOr(process.env.FOLLOWUP_MAX_RETRIES, 3),
  baseDelayMs: numberOr(process.env.FOLLOWUP_RETRY_BASE_DELAY_MS, 500),
  executeLimit: numberOr(process.env.FOLLOWUP_EXECUTE_LIMIT, 25),
  processingTimeoutMs: numberOr(process.env.FOLLOWUP_PROCESSING_TIMEOUT_MS, 300000)
});

export const isFollowupEnabled = (): boolean => getFollowupConfig().enabled;

export interface VapiConfig {
  apiKey: string;
  baseUrl: string;
  assistantId: string;
  phoneNumberId: string;
  timeoutMs: number;
}

export const getVapiConfig = (): VapiConfig => ({
  apiKey: process.env.VAPI_API_KEY || '',
  baseUrl: (process.env.VAPI_BASE_URL || 'https://api.vapi.ai').replace(/\/+$/, ''),
  assistantId: process.env.VAPI_ASSISTANT_ID || '',
  phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || '',
  timeoutMs: numberOr(process.env.VAPI_TIMEOUT_MS, 15000)
});

export const isVapiCallConfigured = (): boolean => {
  const cfg = getVapiConfig();
  return cfg.apiKey.length > 0 && cfg.assistantId.length > 0 && cfg.phoneNumberId.length > 0;
};

export interface ChatConfig {
  /** Max persisted messages forwarded to the LLM per turn (history window). */
  maxContextMessages: number;
  /** Max user message length (characters). */
  maxMessageLength: number;
}

export const DEFAULT_CHAT_MAX_CONTEXT_MESSAGES = 30;

/**
 * Maximum text-turn history window sent to the LLM (Phase 4).
 * Configuration-driven, never hardcoded at call sites. Older persisted
 * messages are retained in the database; only the LLM input is truncated.
 */
export const getChatMaxContextMessages = (): number => {
  const parsed = Number(process.env.CHAT_MAX_CONTEXT_MESSAGES);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 200) return parsed;
  return DEFAULT_CHAT_MAX_CONTEXT_MESSAGES;
};

export const getChatMaxMessageLength = (): number => {
  const parsed = Number(process.env.CHAT_MAX_MESSAGE_LENGTH);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4000;
};

export const getChatConfig = (): ChatConfig => ({
  maxContextMessages: getChatMaxContextMessages(),
  maxMessageLength: getChatMaxMessageLength(),
});
