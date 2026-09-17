# Conversation Calendar Scheduling (Phase 8)

Authenticated text conversations can check availability and book meetings
explicitly via `conversationId`. The provider abstraction, slot validation,
retry/idempotency model, and legacy call behavior are reused unchanged. No
meeting is ever booked automatically (including after qualification), and the
logistics `required_date` is never treated as a meeting time.

## Endpoints (chat bearer auth + rate limits, same router)

- `GET /api/v1/conversations/:id/calendar/availability?start=&end=&timezone=`
  → `200 { available }`. Reuses `checkCalendarAvailability` (pure slot check,
  no identity needed). Conversation must exist (404) and not be abandoned
  (409). Missing slot → 400; invalid → 422; disabled/unconfigured → 503 with
  the truthful "not configured" message; provider errors → 502. No provider
  internals leak.
- `POST /api/v1/conversations/:id/calendar/book`
  `{ start, end, timezone?, title?/summary?, notes?/description? }`
  → `201` created / `200` duplicate (stored meeting). Explicit `start`+`end`
  required (400 otherwise). Abandoned → 409; unlinked lead → 422; invalid
  slot → 422; busy → 409; ineligible tier → 403; disabled/unconfigured → 503;
  provider errors → 502 with sanitized messages. Client-supplied
  `leadId`/`callId` are ignored — the trusted `leadId` always comes from the
  conversation record, and `callId` is never fabricated (stored NULL).

## Explicit confirmation model

`User provides time → availability check → assistant confirms slot →
explicit booking action` (endpoint or `scheduleMeeting` tool). The assistant
asks for a time when missing ("Sure. What time would you prefer?") and never
books from vague intent ("Can we have a call tomorrow?") or from
`required_date`. `scheduleMeeting`/`checkCalendarAvailability` tools accept
only `{start,end,timezone,…}` (+ title/summary/notes for booking); identity
and `required_date` keys are rejected, and booking requires a linked lead.

## required_date vs meeting time

`buildCalendarSlot` accepts explicit datetimes only (ISO parse, end > start,
not past, 15–120 min by default, valid IANA timezone with configured
fallback). `required_date` is logistics data and is never read by any
scheduling code path. Booking never writes logistics state.

## Google Meet behavior

Reuses `GoogleCalendarProvider.createEvent` (`conferenceData.createRequest`
with the stable booking key as `requestId`, so Meet generation is idempotent
across retries). Normalized result persisted: `external_event_id`,
`meet_url`, slot, timezone, provider. Tokens/secrets never logged, persisted,
or returned (see `sanitizeCalendarErrorMessage`).

## Idempotency

Key `cal:{provider}:conv:{conversationId}[:{n}]` (legacy
`cal:{provider}:{callId|leadId}[:{n}]` untouched). Same key + same slot hash
→ stored meeting returned, no new provider event. Changed slot →
deterministic `:n` occurrence. Availability is re-checked immediately before
each insert, so busy/overlapping slots resolve to `unavailable` (409) rather
than double-booking.

## Failure handling

Disabled / missing OAuth / invalid slot / busy / tier-ineligible / provider
errors each map to truthful outcomes with persisted `failed`/`skipped_*`
rows and sanitized messages. One failure affects only that attempt.

## meeting.scheduled event

After a successful booking the controller fire-and-forgets
`meeting.scheduled` through the n8n emitter (never blocks the response):
`{ bookingId, conversationId, leadId, provider, start, end, meetUrl }` with
`source: 'conversation'`. Downstream dedupes via the stable
`n8n:meeting.scheduled:{conversationId}` event id. No follow-ups are created
for meetings; conversation state is not modified.

## Security model

Trusted identity only (conversation record); forged `leadId` ignored at the
endpoint and rejected in tools; malformed dates/timezones rejected by slot
validation; no booking without explicit time or without a linked lead;
OAuth/Google errors sanitized; responses carry no tokens or stack traces.
