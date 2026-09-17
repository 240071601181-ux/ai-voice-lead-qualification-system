# Frontend Text Conversation (Phase 9)

Real UI over the Express/PostgreSQL conversation API. No mock conversations,
no fake assistant text, no second backend. Calls/Vapi UI is untouched.

## Routes

- `/conversations` — list (title "Conversations"): channel/status filters,
  client-side page filter, pagination, per-row qualification tier, latest
  activity, "No conversations yet." empty state, "New Conversation" dialog
  (optional `LeadPicker`, channel defaults to web, navigates to the created
  id), "Connect chat" token dialog.
- `/conversations/:id` — detail: header, `AIChatBox` history + composer on
  the left; lead context, status + Complete/Abandon (confirmed via dialog),
  qualification, logistics state, and meeting panels on the right.

Both routes sit behind the existing `RequireAuth` + sidebar layout, and the
sidebar (`OPERATIONS`) plus global search include Conversations. Calls stay.

## API service (`client/src/api/services/conversations.ts`)

`createConversation`, `listConversations`, `getConversation`,
`getConversationMessages`, `sendConversationMessage`,
`completeConversation`, `abandonConversation`, `getConversationState` (new
additive backend `GET /:id/state`), `qualifyConversation`,
`getConversationQualification`, `getConversationAvailability`,
`bookConversationMeeting`. All go through the shared `httpClient`
(`VITE_API_BASE_URL`, envelope handling) — no duplicated fetch config.

## State management (`client/src/api/hooks/useConversations.ts`)

React Query over the shared client. Sending appends the persisted
user+assistant pair to the cached history in backend order (no optimistic
fakes; failures append nothing so the composed text survives for retry),
then invalidates detail/state/lists and seeds a fresh qualification when the
response carries one. Completing/abandoning refreshes detail + lists;
availability fires only from the explicit check action; booking invalidates
detail. Deterministic failures (400/401/403/404) never retry.

## Chat rendering

`AIChatBox` is reused with backend-mapped `{ role, content, timestamp }`
messages (`toVisibleMessages` drops system/tool rows and sorts
chronologically, so tool calls, SQL, prompts, and metadata never render).
Assistant bubbles render Markdown; Enter sends, Shift+Enter newlines; a
spinner shows while the mutation is pending (no fake streaming). The
composer disables with an explanatory note once the conversation leaves
`active`; failed sends keep the transcript and show a retry-safe error.

## Error handling

`conversationErrorCopy` maps kinds to fixed user-safe strings: 401 → connect
hint, 404 → not-found, 409 → "This conversation is no longer active.",
429 → "Too many messages. Please wait a moment.", 500/unavailable → "Something
went wrong while generating the response." No stacks, SQL, JWT details,
credentials, or prompt content ever render.

## Qualification / logistics / lead panels

Qualification renders backend `score`/`tier`/criteria (HOT/WARM/COLD via the
existing `TierBadge`; never computed here) with a manual "Score now" action.
Logistics rows render the backend state row verbatim ("—" for unknowns; no
frontend extraction). Lead context shows name/phone/status with a link to
`/leads/:id`.

## Meeting flow (`MeetingPanel`)

Explicit start/end (+ timezone, optional title) → "Check availability" →
available → "Book meeting" → persisted booking + Meet URL render. Nothing is
inferred from `required_date`; nothing auto-books. Errors reuse the calendar
truthful-message mapping (503 → not-configured copy).

## Authentication (Phase 10)

**Architecture (verified, not assumed).** The Express backend has no user
store and no login session: every non-conversation route is unauthenticated,
and conversation routes verify only the `CHAT_JWT_SECRET`-signed Bearer
token (`sub`/`iat`/`exp`, timing-safe compare, fail-closed 401). The
frontend shell session is UI-only demo state (`localStorage` flag, no
credential verification) plus the Manus platform cookie for the frontend's
own dev server — neither is verifiable by the Express backend. There is
deliberately **no** `POST /auth/token` issuance endpoint: with nothing to
bind issuance to, it would mint tokens for anyone (security theater), so it
was not built.

**Dev flow (safest compatible).** An operator mints a short-lived token with
backend access and pastes it once into "Connect chat"; the UI validates JWT
shape and pre-checks `exp` before saving, stores it in `sessionStorage`
(tab-only, cleared on logout), and sends it solely as the `Authorization`
header on conversation calls. Nothing is hardcoded and no secret touches
`VITE_*` or the bundle (verified by test + `check`).

**401 handling (no loops).** A rejected saved token is cleared exactly once
(`handleChatUnauthorizedOnce`) and the UI flips to the connect state;
requests without a token show the connect hint immediately. Conversation
screens never show the platform "session expired" copy for chat-auth
failures: 401 → connect hint, 404 → not-found, 409 → inactive, 429 →
rate-limit, 500 → generation-failure copy. Real platform-session expiry
still routes to Sign In via the existing shell flow.

**Qualification/search hardening (Phase 10).** New minimal backend reads
(`GET /api/v1/qualifications`, `GET /api/v1/qualifications/:id`) back the
qualifications list/detail and global-search qualification group — the
detail page no longer falls back to demo fixtures, and conversation-anchored
rows (no `callId`) resolve directly. The Calls page keeps its demo rows but
is now badged DEMO DATA (no call-list API exists).

**Production limitation (explicit).** Single-tenant, no persisted
user/workspace ownership: any valid chat token accesses any conversation.
Shipping beyond dev requires a backend login-bound mint endpoint
(`POST /api/v1/conversations/auth/token` behind a real session, short
expiry, `sub` = authenticated user) plus per-user conversation ownership —
both open items, intentionally not faked here.

## Tests

`vitest.config.ts` now also includes `client/src/**/*.test.ts` (node env —
no jsdom in this repo, so no renderer tests):
- `services/conversations.test.ts`: paths/methods/bodies, chat-token
  header, envelope + error-kind mapping (401/404/409/429/500), network
  failure — fetch mocked at the boundary.
- `components/app/conversationView.test.ts`: ordering/filtering, error copy,
  composer gating, tier copy, logistics rows, timestamps, empty-state copy.
