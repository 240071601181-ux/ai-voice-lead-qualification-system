# Frontend Text Conversation (Phase 9 + Phase 12 polish)

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

## Authentication (Phase 11 — real backend sessions)

The temporary "Connect chat" paste-token workflow is removed (no modal, no
`sessionStorage` token, no token instructions in the normal flow).

- Login/signup/logout run against `POST /api/v1/auth/*` with real
  bcrypt-verified sessions (see `docs/authentication.md`); route guards
  enforce the backend-verified session, and logout revokes server-side.
- The access token lives in module memory only; reload restores via one
  refresh attempt, and conversation calls refresh-once-and-retry (no loops).
- A surviving 401 means signed-out: the UI offers Sign in (never a token
  modal, never the platform "session expired" copy for chat-auth failures).
- Ownership is server-enforced per user (resource-hiding 404s); the UI shows
  only the caller's rows and drops cached rows on logout.
- Remaining limits: single-tenant leads, no per-workspace tenancy, no
  password reset/SSO/email verification (those screens say so truthfully).

## Tests

`vitest.config.ts` now also includes `client/src/**/*.test.ts` (node env —
no jsdom in this repo, so no renderer tests):
- `services/conversations.test.ts`: paths/methods/bodies, chat-token
  header, envelope + error-kind mapping (401/404/409/429/500), network
  failure — fetch mocked at the boundary.
- `components/app/conversationView.test.ts`: ordering/filtering, error copy,
  composer gating, tier copy, logistics rows, timestamps, empty-state copy,
  plus Phase 12 layout helpers (`formatStatusLabel`, `messageAlignment`,
  `shouldShowComposerDisabledNote`, empty-state constants, completed-composer
  gating, full 401/404/409/429/500 copy).

## Phase 12 — conversation-screen polish (no backend/API/auth changes)

Final `/conversations/:id` structure:

- Back link ("Back to Conversations") + header card: lead name (or
  "Conversation" fallback), `Active/Completed/Abandoned` status chip,
  channel chip, message count from `messageCount`, latest activity from
  `updated_at`, truncated conversation id (full id in `title` tooltip only).
- Main column: fixed-height `AIChatBox` (`clamp(480px, 68vh, 720px)`,
  internally scrollable so the page never grows with history), user bubbles
  right-aligned / assistant left-aligned, max width `min(70%, 38rem)` with
  `overflow-wrap: anywhere` + `word-break: break-word` (long messages wrap,
  no horizontal overflow), per-message timestamps, "Assistant is typing…"
  loading row (`role="status"`), send-error row with Sign-in affordance on
  401, disabled-composer note for non-active states.
- Side column: Status panel (`Status: Active` label/value + confirmed
  Complete/Abandon, disabled unless `active`), Lead panel (`Name/Phone/Status`
  label/value rows + "Open lead →"), Qualification panel (`Score/Tier` rows +
  `Criteria` list; empty state uses the exact
  "Not scored yet. Qualification appears automatically once enough details
  are known." copy — never an invented score), Logistics panel (backend rows
  only, empty state "No structured logistics details yet."), Meeting panel
  (explicit Start/End/Timezone/Title fields with spacing, an "Explicit time
  required" banner, Check availability → Book meeting, never inferred from
  `required_date`).
- Layout CSS (`conversation-page/header/layout`, `panel-card`, `kv-list`,
  `state-list`, `criteria-list`, `meeting-field`, status chips) lives in
  `client/src/index.css`. Grid is `1fr + 300–360px` on desktop, stacks to a
  single column ≤1100px (side panels become an auto-fit grid), single column
  ≤760px. No horizontal overflow (`min-width: 0` + wrapping throughout).
- Pure helpers added in `conversationView.ts`: `formatStatusLabel`,
  `messageAlignment`, `shouldShowComposerDisabledNote`,
  `QUALIFICATION_EMPTY_COPY`, `LOGISTICS_EMPTY_COPY`. No business logic or
  mock data added for tests.

Remaining known limitations:

- Live browser QA against a running backend/DB was not executed in this
  environment; flow correctness was verified statically (send appends the
  persisted user+assistant pair in backend order with no optimistic fakes;
  failures append nothing; Complete/Abandon refresh detail so the composer
  disables while history stays; availability fires only from the explicit
  check and Book stays disabled until `available === true`) plus unit/build
  checks. Re-verify the Hi → Chennai→Bengaluru → 32 ft → ₹25000 script, the
  401/404/409/429/500 states, Complete/Abandon transitions, and explicit-time
  availability → booking in a live browser before release.
- `server/frontend.contract.test.ts` fails pre-existing (missing
  `client/src/pages/Home.tsx`); untouched by this phase.
- Unrelated working-tree changes (`docs/authentication.md`, `src/app.ts`,
  `src/tests/auth.test.ts`) were already present and left alone.
