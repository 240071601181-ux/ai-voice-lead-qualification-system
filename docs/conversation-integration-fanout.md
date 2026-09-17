# Conversation Integration Fan-out (Phase 7)

```
conversation → qualification (persisted, Phase 6)
  → async fan-out (fire-and-forget, never in the LLM path)
    → CRM sync + n8n event + WhatsApp summary + follow-up scheduling
```

No new frameworks: every provider reuses its existing abstraction, retry
helper, delivery table, and idempotency mechanism. The LLM has no tool path
to any integration — fan-out runs only on persisted qualification rows.
Legacy `call.completed` and all call-anchored fan-out are unchanged.

## Trigger

`qualifyConversation()` enqueues one fan-out event after a successful
persist (manual endpoint, auto-qualify after state changes, and completion
all flow through it). Event payload is minimal:

`qualificationId, conversationId, leadId, score, tier, qualifiedAt` —
no JWTs, API keys, prompts, or message history.

## CRM

- Trigger: every persisted conversation qualification.
- Identity: lead resolved from trusted conversation → state → qualification;
  mapper emits `external_conversation_id` (explicit context, else the
  qualification row lineage). No `callId` is ever fabricated
  (`external_call_id` omitted for text).
- Idempotency: `crm:{provider}:conv:{conversationId}` (legacy
  `crm:{provider}:{callId|leadId}` untouched) + payload-hash no-change skip.
- Retry: existing `withCrmRetry`; failures recorded in `crm_syncs`, never
  thrown. Secrets redacted by `sanitizeCrmErrorMessage`.

## n8n

- Trigger: `qualification.completed` via the existing emitter (HMAC signing,
  provider abstraction, retry, `n8n_deliveries` persistence unchanged).
- Identity: event id `n8n:qualification.completed:{conversationId}`;
  envelope `data.source = 'conversation'` plus
  `data.conversation = { id, channel?, status? }`, and
  `data.qualification.conversation_id`. Legacy envelopes serialize
  byte-identically (markers omitted when absent).
- Idempotency: stable event id + payload-hash skip; changed data gets the
  deterministic `:n` discriminator. Failures recorded per workflow.

## WhatsApp

- Trigger: HOT → `call_summary_hot`, WARM → `call_summary_warm` only.
  COLD gets no summary; tier-mismatched templates are suppressed (existing
  checks, now fed by the conversation qualification).
- Consent: deny-by-default gate untouched — without consent the send is
  skipped as `skipped_no_consent` and persisted; no consent is invented.
- Idempotency: `wa:{provider}:{template}:{conversationId}` + payload-hash
  skip. Failures recorded, secrets/numbers redacted.

## Follow-ups (existing tier policy)

- HOT: WhatsApp +30m (`FOLLOWUP_HOT_DELAY_MIN`), CRM +60m
  (`FOLLOWUP_CRM_DELAY_MIN`); WARM: WhatsApp +240m
  (`FOLLOWUP_WARM_DELAY_MIN`), CRM +60m; COLD: nothing; no qualification:
  missed-reminder evaluation only.
- Keys anchored per conversation (`fu:{action}:{conversationId}`);
  terminal rows are duplicate-protected; the anchor travels in the row
  payload so execution-time dispatch resolves conversation state (legacy
  rows fall back to lead-only, as before).

## Calendar

No automatic booking: qualification only marks eligibility. Booking still
requires an explicit slot — logistics `required_date` is NOT meeting time.
No calendar code runs on this path (asserted in tests).

## Anchors & idempotency summary

New text activity: `conversationId + qualificationId + leadId`
(conversation-scoped keys; lineage also queryable via
`delivery.qualification_id → qualifications.conversation_id`).
Legacy call activity: `callId + qualificationId + leadId` (unchanged).
No schema migration was required: all delivery tables already carry nullable
`call_id` + `qualification_id`.

## Error isolation

Each provider runs isolated (`Promise.allSettled` + per-provider try/catch
+ each service's own never-throw contract). Example: CRM down →
`crm_syncs.failed`; n8n still delivered; WhatsApp `skipped_no_consent`;
follow-ups scheduled; conversation and qualification unaffected.

## Observability

Structured logs carry `conversationId`, `leadId` (`callId` where legacy),
`qualificationId`, `tier`/`score`, provider outcome, and durations.
Never logged/persisted: secrets, JWTs, full message content, raw DB errors.
