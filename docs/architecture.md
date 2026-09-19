# Architecture Overview

> **Phase 14 — text-first architecture (voice retired).** Text conversations
> are the primary AI interaction model. The legacy voice/Vapi system
> (outbound calls, webhooks, custom-LLM callbacks, `endCall` tool,
> `VAPI_*` config) is retired: its routes, controllers, services, and UI
> are removed. What remains:
>
> ```
> Lead
>  ↓
> Conversation
>  ↓
> Messages
>  ↓
> AgentOrchestrator (processTurn: conversationId, context, channel, messages)
>  ├── Conversation State (conversation_states, legacy call-anchored reads kept)
>  ├── RAG (knowledge base)
>  ├── LLM (Ollama/OpenAI; mock is tests-only)
>  └── Tools (explicit allowlist: updateConversationState,
>      updateLeadInformation, getConversationState,
>      checkCalendarAvailability, scheduleMeeting)
>  ↓
> Qualification (deterministic scorer, unchanged)
>  ↓
> Integrations (CRM / n8n / WhatsApp / Calendar / Follow-ups)
> ```
>
> **Retained legacy database tables (read-only compatibility, NOT dropped):**
> `calls` (queryable via `callRepository.findCallById` for legacy
> call-anchored enrichment) and the old `conversation_state` table
> (legacy call-anchored state reads). No voice write path remains, no
> production data was destroyed, and no destructive reset was run.
>
> The sections below are the original design record; voice-specific rows are
> marked **[RETIRED Phase 14]** where they no longer apply.

## 1. System Architecture

| Component | Responsibility | Input | Output | Communication Partner | Sync/Async |
|-----------|----------------|-------|--------|-----------------------|------------|
| **Lead Source** | Ingest leads from web forms, email, or partner APIs | Raw lead payload (JSON) | Normalised lead record | Backend API (`POST /leads`) | Async |
| **Telephony (Vapi)** [RETIRED Phase 14] | Formerly initiated outbound calls | – | – | Removed | – |
| **Speech‑to‑Text (STT)** [RETIRED Phase 14] | Formerly transcribed caller speech | – | – | Removed | – |
| **Text‑to‑Speech (TTS)** [RETIRED Phase 14] | Formerly synthesised audio replies | – | – | Removed | – |
| **LLM (e.g., OpenAI/Anthropic)** | Generates conversational replies, decides when to call tools, maintains dialogue flow | Transcribed text, conversation state, system prompt | Assistant reply (text) | RAG (optional), Tools (function calls) | Real‑time |
| **RAG / Knowledge Base** | Provides domain‑specific facts (service catalog, pricing, policies) | Retrieval query, document IDs | Relevant passages | LLM (as context) | Real‑time (cached) |
| **Conversation State** | Stores extracted slot values during a call (name, origin, destination, cargo, budget…) | LLM‑extracted entities, tool results | Updated state object | LLM (next turn) | Real‑time (persisted/recoverable) |
| **Tools / Function Calling** | Executes side‑effects: DB writes, CRM updates, calendar checks, WhatsApp messages, human hand‑off | Structured request from LLM | Success/failure payload | Backend services / external APIs | Mixed (latency‑sensitive tools may run in‑call, others async) |
| **Backend (Express/TS)** | Orchestrates HTTP API, webhooks, business logic, persistence | HTTP requests, webhook payloads | HTTP responses, DB writes | All other components | Mixed |
| **PostgreSQL** | Durable storage for leads, calls, transcripts, qualification scores, meetings | CRUD operations from services | Persistent rows | Backend services | Async |
| **CRM** | External customer‑relationship system (e.g., HubSpot) | Lead updates, activity logs | Confirmation / IDs | Backend (tool) | Async |
| **n8n** | Low‑code workflow engine for orchestration of follow‑ups, retries, notifications | Webhook events, API calls | Workflow execution | Backend (webhook) | Async |
| **Google Calendar / Meet** | Checks availability, creates events, generates Meet links | Desired meeting time, participant email | Calendar event ID, Meet URL | Backend (tool) | Async |
| **WhatsApp (Twilio)** | Sends confirmation / meeting invites via WhatsApp | Text template, recipient number | Message SID | Backend (tool) | Async |
| **Monitoring / Logging** | Captures metrics, latency, errors, audit trails | Log statements, metric counters | Logs, dashboards (e.g., Grafana) | All components | Async |

### Why these components?
- **Modularity** – each responsibility lives in its own service, making it testable and replaceable.
- **Latency‑critical path** – only the telephony‑STT‑LLM‑TTS loop stays in‑process to meet sub‑600 ms goals.
- **Asynchronous side‑effects** – CRM updates, calendar scheduling, and follow‑ups are decoupled via webhooks/n8n to avoid blocking the voice conversation.
- **RAG** – kept out of the hot path; invoked only when the LLM explicitly requests external knowledge.

## 2. Real‑time Conversation Path (text-first, Phase 14)

```
Customer → Text chat (web) → AgentOrchestrator → LLM (system prompt + state) →
   [optional] RAG/tool (explicit allowlist) → Assistant reply → Customer
   → State persisted → Qualification → CRM/n8n/WhatsApp/Calendar/Follow-ups
```

**Critical fast operations** (must stay < 600 ms):
- Audio capture & streaming (Vapi)
- STT transcription
- LLM inference (short prompt, cached model)
- TTS synthesis

All database writes, CRM calls, calendar checks, and WhatsApp messages are **deferred** to the asynchronous path.

## 3. Asynchronous Path

```
Vapi webhook (call‑ended) → Backend / n8n →
   Store call record & transcript → Run qualification engine →
   Update CRM → If HOT/WARM → Check calendar → Schedule meeting →
   Generate Google Meet link → Send WhatsApp confirmation →
   Create follow‑up task (n8n) → Log metrics
```

This path can tolerate higher latency (seconds to minutes) because the user is no longer on the phone.

### Phase 9 – CRM Synchronization (provider-independent, async, failure-isolated)

```
call.ended → handleEnded → qualifyCall (deterministic 0–100, HOT/WARM/COLD)
    → enqueueCrmSync (fire-and-forget setImmediate, never awaited)
    → gather via existing LeadService/call/state/qualification readers
    → crmMapper.toCrmContactPayload (missing data omitted, tier passthrough)
    → CrmProvider.upsertContact (generic HTTP provider; Idempotency-Key header)
    → record outcome in crm_syncs (pending/success/failed/skipped_no_changes)
```

- Idempotency key `crm:{provider}:{call_id}` (DB UNIQUE); unchanged payloads skip the provider call via sha256 `payload_hash` comparison.
- Bounded retries (timeout + exponential backoff + jitter) on network/timeout/429/5xx only; 4xx fails fast without retry.
- CRM failure never breaks call completion or qualification; credentials are never logged; the LLM has no CRM access (integration layer only, no new LLM tools).
- `leads.status` is never written by CRM sync; HOT/WARM/COLD travels as a CRM-side tag/field only.

### Phase 10 – n8n Workflow Automation (async outbound fan-out, failure-isolated)

```
lead created/updated → persist → enqueueN8nEvent (fire-and-forget)
call.ended → handleEnded → qualifyCall → enqueueCrmSync (sibling tail)
    ├─→ enqueueN8nEvent('call.completed') — emitted even if qualification fails
    ├─→ enqueueN8nEvent('qualification.completed') — after qualifyCall resolves
    └─→ crm terminal outcome → enqueueN8nEvent('crm_sync.completed', { ok, skipped })
each event → gather via existing readers → build allowlisted envelope
    → per-workflow POST (HMAC-SHA256 signature, timeout, bounded retries)
    → record in n8n_deliveries (pending/delivered/failed/skipped_no_changes)
```

- Events: `lead.created`, `lead.updated`, `call.completed`, `qualification.completed`, `crm_sync.completed`. In-call events (initiated/answered, turns, transcription) never emit.
- Envelope `{ event, event_id, occurred_at, data }` with allowlisted `lead/call/shipment/qualification/crm` fields only — no transcripts, no full history; tier is the Phase 8 value verbatim.
- Idempotency: stable `event_id = n8n:{event}:{anchor}[:{discriminator}]`, `UNIQUE(event_id, workflow)`; unchanged re-emissions skip the POST via sha256 payload-hash comparison; changed data gets a deterministic `:n` suffix.
- n8n authenticates deliveries via `X-N8n-Signature` (HMAC-SHA256 over canonical body with `N8N_WEBHOOK_SECRET`); HTTPS-only URLs; secrets never logged or persisted.
- CRM and n8n are siblings: neither awaits the other; failure of one cannot affect the other, call completion, or qualification. The LLM has no n8n access (no tools, no orchestrator imports). Disabled by default (`N8N_ENABLED=false`). No inbound n8n routes, no queues, no cron.

### Phase 11 – WhatsApp Template Messaging (async outbound, deny-by-default)

```
lead.created → persist → enqueueWhatsappMessage('lead_welcome') [consent-gated]
call.ended → handleEnded → qualifyCall
    ├─→ enqueueWhatsappMessage('call_missed') — suppressed at send time when
    │       conversation state shows requirements were collected
    └─→ HOT/WARM → enqueueWhatsappMessage('call_summary_hot'/'call_summary_warm')
each send → re-read lead/call/state/qualification → consent gate → resolve
    vendor content SID → build allowlisted variables → Twilio sendTemplate
    → record in whatsapp_deliveries (pending/delivered/failed/skipped_*)
```

- Templates only (`lead_welcome`, `call_summary_hot`, `call_summary_warm`, `call_missed` × en/hi/ta); text lives vendor-side as approved content — never composed by backend or LLM. No `opt_out_confirm`: no inbound WhatsApp/STOP handling exists in this phase (future work).
- Consent: deny-by-default — the repo has no consent source yet, so `WHATSAPP_REQUIRE_CONSENT=true` (default) skips every send with `skipped_no_consent`; `false` is an explicit sandbox-only override. No opt-in columns or API fields were added.
- Idempotency: stable key `wa:{provider}:{template}:{anchor}`, `UNIQUE(message_key)`; unchanged re-emissions skip via sha256 hash. Bounded retries on network/timeout/429/5xx; 4xx fails fast.
- WhatsApp is a sibling of CRM/n8n: no cross-imports, failures contained, LLM has no access. Disabled by default (`WHATSAPP_ENABLED=false`). No inbound routes, no queues, no cron.

### Phase 12 – Calendar + Google Meet (explicit internal bookings only)

```
internal client → POST /api/v1/calendar/bookings { leadId|callId, start, end, timezone? }
    → thin controller validates → calendarBookingService (awaited, bounded retries/timeouts)
    → re-read lead/call/state/qualification → tier eligibility (COLD never books)
    → build + validate explicit slot (required_date is NEVER a meeting time)
    → dedupe by booking key + slot hash → freebusy availability check
    → events.insert with Meet conferenceData (requestId = booking key)
    → store external event ID + Meet URL in calendar_bookings
GET /api/v1/calendar/availability?start=&end=&timezone= → standalone freebusy check
GET /api/v1/calendar/bookings/:id → stored booking status + Meet URL
```

- No automatic booking from `call.ended`: qualification determines eligibility only; every booking requires an explicit requested slot. No n8n event is emitted for meetings — details are stored for future phases.
- Idempotency: stable key `cal:{provider}:{anchor}[:{n}]`, `UNIQUE(booking_key)`; same slot returns stored IDs; changed slots get a deterministic `:n` suffix. Google-side conference `requestId` makes Meet creation retry-safe.
- Bounded retries on network/timeout/429/5xx + Google transient reasons; 4xx/validation fail fast; busy slots record `skipped_unavailable` (not an error).
- OAuth2 refresh-token auth (tokens refreshed in memory, never persisted); secrets never logged or stored. Disabled by default (`CALENDAR_ENABLED=false`). LLM has no calendar access (no tools, no orchestrator imports). No queues, no cron.

### Phase 13 – Follow-up Automation (scheduled rows only, no scheduler infra)

```
call.ended → handleEnded → qualifyCall → enqueueFollowupScheduling (fire-and-forget setImmediate)
manual POST /api/v1/qualifications → qualifyCall → enqueueFollowupScheduling
each scheduling → re-read lead/call/state/qualification → followupPolicy.resolvePlan (tier-driven)
    HOT:  whatsapp_followup(call_summary_hot, +FOLLOWUP_HOT_DELAY_MIN) + crm_followup(+FOLLOWUP_CRM_DELAY_MIN)
    WARM: whatsapp_followup(call_summary_warm, +FOLLOWUP_WARM_DELAY_MIN) + crm_followup(+FOLLOWUP_CRM_DELAY_MIN)
    no meaningful contact → missed_reminder replaces the tier WhatsApp (same tier delay)
    COLD → nothing scheduled
    → persist pending rows in follow_ups (UNIQUE followup_key, deterministic :n discriminator)
future scheduler → POST /api/v1/followups/execute-due (INTERNAL/admin only) → executeDueFollowUps(limit)
    → claim due rows (pending/failed, scheduled_at<=now) → executeFollowupOnce → dispatch
    → whatsapp_followup/missed_reminder via sendWhatsappOnce (consent gate stays inside sender)
    → crm_followup via syncCrmContactOnce
    → completed / failed (sanitized last_error, backoff-pushed scheduled_at) / cancelled
```

- Idempotency: stable key `fu:{action}:{anchor}[:{n}]`, `UNIQUE(followup_key)`; terminal (completed/cancelled) rows are never overwritten — repeats return `duplicate:true`. Concurrent schedulers converge via atomic claim (`pending/failed → processing`).
- WhatsApp consent is never bypassed: benign sender skips (`no_consent`/`no_phone`/`suppressed`/`no_template`/`no_changes`) complete the follow-up instead of retrying. No new templates, no new providers.
- No cron, workers, queues, or timers in this phase. `executeDueFollowUps()` is a plain bounded async function for a future scheduler. `POST /followups/execute-due` is INTERNAL/admin only — restrict network access until auth exists. Disabled by default (`FOLLOWUP_ENABLED=false`). LLM has no follow-up access (no tools, no orchestrator imports). Qualification scoring untouched.

## 4. Data Flow Examples

### Lead Creation
1. Front‑end or partner API POST `/leads` with raw lead data.
2. Backend validates, normalises, stores in **Leads** table.
3. Returns lead ID; optionally triggers Vapi to start a call (via a background job).

### During Conversation
1. Audio → STT → text.
2. LLM receives text + current **ConversationState**.
3. LLM extracts slots (e.g., `pickup_location`) via function call → **State** updated.
4. If LLM needs pricing, it calls **RAG** → passages returned → included in next LLM prompt.
5. LLM produces reply text → TTS → audio back to caller.

### Lead Qualification
1. After call ends, stored transcript is processed by a **qualification service**.
2. Structured data (urgency, budget, intent) is scored against a rule‑based matrix (see Section 10).
3. Score maps to **HOT / WARM / COLD** and persisted.

### Post‑call Processing
1. Webhook `/webhooks/vapi` receives `call_completed` event.
2. Service stores call metadata, transcript.
3. Qualification runs, updates **Leads** row.
4. If status is HOT/WARM, a meeting‑scheduling workflow is triggered.

### Meeting Scheduling
1. Service queries **Google Calendar** for availability.
2. Creates event + Meet link.
3. Sends WhatsApp message with details.
4. Persists **Meetings** record linked to the lead.

## 5. Database Design (PostgreSQL)

| Table | Primary Key | Important Columns | Relationships |
|-------|--------------|-------------------|----------------|
| **leads** | `id` (UUID) | `source`, `name`, `phone`, `email`, `status` (enum), `created_at` | 1‑many `calls`, 1‑many `qualifications` |
| **calls** (RETAINED read-only, Phase 14) | `id` (UUID) | `lead_id`, `vapi_call_id`, `started_at`, `ended_at`, `duration_seconds`, `status` | many‑to‑1 `leads` |
| **transcripts** | `id` (UUID) | `call_id`, `content` (text), `language` | 1‑1 `calls` |
| **qualifications** | `id` (UUID) | `lead_id`, `call_id`, `score` (int), `tier` (enum), `details` (json) | many‑to‑1 `leads` |
| **meetings** | `id` (UUID) | `lead_id`, `calendar_event_id`, `meet_url`, `scheduled_for`, `status` | many‑to‑1 `leads` |
| **activities** | `id` (UUID) | `lead_id`, `type` (enum), `payload` (json), `created_at` | many‑to‑1 `leads` |

All tables use `uuid_generate_v4()` for IDs, timestamps with timezone, and appropriate foreign‑key constraints.

## 6. API Design (Express)

| Method | Path | Purpose | Auth | Request Body | Response |
|--------|------|---------|------|--------------|----------|
| `POST` | `/api/leads` | Create a new lead | API‑Key / JWT | `{source, name, phone, email, ...}` | `{id, status}` |
| `GET` | `/api/leads/:id` | Retrieve lead details | API‑Key / JWT | – | Lead object + latest qualification |
| `PATCH` | `/api/leads/:id` | Update mutable fields (e.g., status) | API‑Key / JWT | `{status?, notes?}` | Updated lead |
| `POST` | `/api/webhooks/vapi` [RETIRED Phase 14] | Formerly received Vapi events | – | – | Gone (`404`) |
| `POST` | `/api/qualification` | Trigger manual qualification (optional) | API‑Key / JWT | `{leadId, callId}` | Qualification result |
| `POST` | `/api/meetings` | Request meeting creation (internal use) | Service‑to‑service token | `{leadId, preferredTime}` | Meeting record + Meet URL |
| `POST` | `/api/whatsapp` | Send WhatsApp message (internal) | Service token | `{to, templateId, params}` | Message SID |

All endpoints return JSON, use standard HTTP status codes, and are versioned under `/api/v1` in the final implementation.

## 7. Webhook & Event Design

| Event | Source | Payload (summary) | Consumer | Idempotency |
|-------|--------|-------------------|----------|-------------|
| `lead_created` | Front‑end / partner API | `{leadId, source}` | n8n (optional) | `leadId` as key |
| `call_initiated` [RETIRED Phase 14] | Formerly backend (Vapi request) | – | Removed | – |
| `call_answered` [RETIRED Phase 14] | Formerly Vapi | – | Removed | – |
| `call_ended` [RETIRED Phase 14] | Formerly Vapi webhook | – | Removed | – |
| `qualification_completed` | Backend | `{leadId, tier, score, details}` | CRM, n8n, UI | `leadId` |
| `meeting_scheduled` | Backend (Google API) | `{meetingId, leadId, meetUrl, startTime}` | WhatsApp, CRM | `meetingId` |
| `whatsapp_sent` | Twilio | `{messageSid, leadId, status}` | Backend (log) | `messageSid` |

**Reliability measures**:
- All webhook endpoints validate HMAC signatures (Twilio) or JWT. (Phase 14:
  Vapi webhook verification retired with the Vapi routes.)
- Events are stored in an `activities` table for replay.
- Consumers must be idempotent using the unique IDs above.

## 8. AI Architecture

- **LLM** – primary conversational engine. System prompt defines role (virtual sales rep), language handling, and when to call tools. Uses function‑calling schema to request actions (e.g., `updateLead`, `checkVehicleAvailability`).
- **RAG** – vector store of company knowledge (service catalog, pricing tables, FAQs). Queried only when LLM emits a `retrieveKnowledge` tool call.
- **State** – persisted JSON object per active call (e.g., stored in Redis or DB) that can be recovered if the call is interrupted. Contains extracted slots (name, pickup, destination, cargo, date, budget, urgency, intent).
- **Tools** – thin wrappers around backend services. Each tool returns a deterministic JSON payload, enabling the LLM to continue the dialogue.

## 9. Lead Qualification Scoring

A deterministic rule‑based engine runs after the call ends.

| Factor | Weight | Scoring Logic |
|--------|--------|---------------|
| **Urgency** (requested date ≤ 3 days) | 30 | +30 if true else 0 |
| **Budget disclosed** | 20 | +20 if budget > 0 else 0 |
| **Route confirmed** (pickup & destination both known) | 20 | +20 if both present else 0 |
| **Vehicle type confirmed** | 10 | +10 if vehicle selected |
| **Cargo details** (weight/size) | 10 | +10 if provided |
| **Explicit booking intent** ("I want to book now") | 10 | +10 if detected |

**Total score 0‑100** → Tier mapping:
- 70‑100 → **HOT**
- 40‑69 → **WARM**
- 0‑39 → **COLD**

The engine is transparent; the score breakdown is stored in `qualifications.details` for audit.

## 10. Security Considerations

- **API authentication** – JWT signed with a rotating secret; service‑to‑service calls use short‑lived tokens.
- **Environment secrets** – kept in `.env`; never committed. CI/CD injects them at runtime.
- **Webhook verification** – HMAC signatures (Vapi, Twilio) validated before processing.
- **Database** – role‑based access, `pgcrypto` for column‑level encryption of PII (phone, email).
- **Logging** – structured, excludes secrets; uses Winston with redaction filter.
- **Transport** – all external calls over HTTPS; internal services run behind a firewall.

## 11. Failure & Fallback Design

| Failure Point | Retry Strategy | Fallback | User Impact |
|---------------|----------------|----------|-------------|
| Vapi call fails to start [RETIRED Phase 14 — no voice initiation remains] | – | – | – |
| STT error [RETIRED Phase 14 — no speech pipeline remains] | – | – | – |
| LLM timeout | Return a generic fallback phrase (e.g., "Let me check that for you.") and queue async processing | No immediate answer, but conversation stays alive |
| RAG unavailable | Skip knowledge retrieval, inform user "I don't have that info right now" | Continue without external data |
| CRM API error | Queue update in n8n with retry policy (5 attempts) | Lead data eventually syncs | No visible impact during call |
| Calendar unavailable | Offer to send a follow‑up email instead of instant meeting | Delay meeting creation |
| WhatsApp send failure | Retry via Twilio, fallback to SMS if configured | Possible missed confirmation |
| Database outage | Switch to in‑memory cache, persist when DB recovers | Data loss risk mitigated by transaction logs |

All failures are logged with correlation IDs; alerts are sent to a monitoring channel (e.g., Slack).

---

*All design decisions are documented inline to aid future reviewers and to ensure transparent, testable implementations.*
