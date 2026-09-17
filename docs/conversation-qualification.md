# Conversation Qualification (Phase 6)

Qualification migrated from call-anchored to conversation-anchored execution
with **byte-identical scoring**. Legacy voice keeps working unchanged.

## Inputs

`qualifyConversation(conversationId)`:

1. Loads the conversation (trusted record).
2. Resolves `leadId` from `conversation.lead_id` — never from caller input.
3. Loads `conversation_states` for the conversation (scoring source).
4. Scores with the existing `calculateQualification(state, qualifiedAt)`.
5. Persists via `upsertConversationQualification` (one row per
   `conversation_id`; re-qualification updates in place).
6. Returns the persisted row.

Rejected with `err.status`: unknown conversation (404), unlinked lead
(422), no state row yet (422), bad id (400).

## Exact scoring (unchanged — `calculateQualification` is reused, not rewritten)

| Criterion | Points | When |
| --- | --- | --- |
| Urgency | 30 | `required_date` within 0–3 days (UTC day math) |
| Budget | 20 | positive number |
| Route | 20 | `pickup_location` + `destination` present |
| Vehicle | 10 | `vehicle_type` present |
| Cargo | 10 | `cargo_weight` > 0 or `cargo_dimensions` present |
| Booking intent | 10 | `booking_intent === 'explicit'` |

Max 100. Tiers: **HOT ≥ 70, WARM ≥ 40, else COLD**. Output keeps
`{ score, tier, details: { criteria, totalScore, qualifiedAt } }`.
Parity test proves identical slots score identically on both paths.

## conversationId relationship / callId compatibility

- Web/WhatsApp: `conversation_id` set, `call_id` **NULL** (never invented).
- Legacy voice (`qualifyCall`): `call_id` set, unchanged upsert on
  `ON CONFLICT (call_id)`, unchanged result.
- Bridged legacy: both may be set (`qualifyConversation(id, at, { callId })`).
- Migration `015_conversation_qualification.sql` (additive only):
  `call_id DROP NOT NULL` (UNIQUE kept; NULLs coexist) + partial unique
  index `qualifications_conversation_id_unique_idx` enabling
  `ON CONFLICT (conversation_id) WHERE conversation_id IS NOT NULL`.

## Trigger rules (deterministic, least disruptive)

Auto-qualification (`maybeAutoQualifyConversation`, persistence only) fires
only when the gate passes — evaluated through the scorer's own criteria:

- explicit booking intent → qualify, OR
- route known **and** ≥2 of budget/vehicle/cargo/urgency qualified → qualify,
- otherwise → skip (no premature qualification on thin state).

Trigger points: after a real state change in `POST /messages` (heuristic
extraction or successful `updateConversationState` tool), on
`POST /:id/complete`, or manually via `POST /:id/qualification`.
`abandon` never qualifies. Recalculation happens as new info arrives
(upsert updates the single row).

## Idempotency

One row per conversation (partial unique index). Repeat calls update the row
(`score/tier/details/qualified_at/updated_at`) instead of inserting.
State changes re-qualify to a new score on the same row id.

## Completion behavior

`POST /conversations/:id/complete` ends the conversation and recalculates
when the gate passes; the (possibly null) qualification is returned
additively as `data.qualification`. No CRM/WhatsApp/n8n/calendar side
effects in this phase.

## API

- `POST /api/v1/conversations/:id/qualification` → 201 persisted row
  (404 unknown conversation, 422 unlinked lead / no state yet).
- `GET /api/v1/conversations/:id/qualification` → 200 row or 404.
- Both behind the existing chat bearer auth + rate limits.

## No-loop guarantee

Qualification is persistence only: no integration enqueues exist on this
path, so `message → qualification → integration → message` recursion is
structurally impossible. `maybeAutoQualifyConversation` also never throws
into the chat turn.
