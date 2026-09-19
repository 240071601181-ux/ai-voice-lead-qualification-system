# Frontend Text Conversation (Phase 9 + Phase 12 polish + Phase 14 voice retirement)

Real UI over the Express/PostgreSQL conversation API. No mock conversations,
no fake assistant text, no second backend. (Phase 14: legacy Calls/Vapi UI
retired — old `/calls` URLs redirect to `/conversations`.)

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

- Live browser-equivalent QA against the running backend + PostgreSQL was
  executed in the Phase 12 stabilization pass (see "Conversation Detail UI
  and Interaction Flow" below); the static-only verification note from the
  earlier pass no longer applies to the conversation flow.
- `server/frontend.contract.test.ts` fails pre-existing (missing
  `client/src/pages/Home.tsx`); untouched by this phase.
- Unrelated working-tree changes (`docs/authentication.md`, `src/app.ts`,
  `src/tests/auth.test.ts`) were already present and left alone.

## Conversation Detail UI and Interaction Flow (Phase 12 stabilization)

Live API-level QA was executed against the running backend
(`http://localhost:4000`) + PostgreSQL in this phase (register ? lead ?
conversation ? send "Hi, I need a truck from Chennai to Bengaluru." ? real
LLM reply ? state ? Score now ? availability ? book ? complete ? refresh;
QA rows removed afterwards).

### Responsive layout

- Desktop: CSS grid `minmax(0,1fr) minmax(300px,360px)` � conversation +
  messages left; Status / Lead / Qualification / Logistics / Meeting stacked
  right (`ConversationDetailPage.tsx` + `conversation-layout` in
  `index.css`).
- 1100px and below: single column; side panels become an auto-fit grid
  (`minmax(min(260px,100%),1fr)`) so cards keep normal width instead of
  squeezing. 760px and below: single column, tighter label columns.
- `min-width: 0` on every grid/flex child; `overflow-wrap: anywhere` on
  bubbles, rows, and notes � no horizontal page overflow at 768�1920px.
- Panel action buttons use flexible height (`min-height: 35px`, wrapping
  labels) so "Check availability" never clips inside narrow cards.
- The chat box keeps a fixed `clamp(480px, 68vh, 720px)` height with
  scrolling contained in the message area; the composer stays visible and
  the chat never pushes side panels off-screen. A previous mount-once
  min-height spacer on the last message (stale on resize, ~500px dead
  space) was removed; the view scrolls to the newest message on
  history/loading changes.

### Button to API mapping (all real, React Query + services only)

| Button | Hook, service, endpoint | UI update |
| ------ | ----------------------- | --------- |
| New Conversation, Create and open | `useCreateConversationMutation` to `POST /api/v1/conversations {leadId, channel}` | invalidates lists, navigates to `/:id` |
| Open conversation (row click) | `useConversationQuery` to `GET /:id` | detail render; 404 shows "Conversation not found." |
| Send (composer / suggested prompt) | `useSendConversationMessageMutation` to `POST /:id/messages {content}` (60s timeout) | appends persisted pair, invalidates detail/state/lists, seeds qualification; failure keeps text for retry |
| Retry (detail / messages / panels) | query `refetch()` | re-fires the same endpoint |
| Score now | `useQualifyConversationMutation` to `POST /:id/qualification` | "Scoring�", duplicate clicks blocked, seeds qualification cache; 422 shows the backend reason (e.g. no state yet) |
| Complete / Abandon | `useCompleteConversationMutation` / `useAbandonConversationMutation` to `POST /:id/complete` / `POST /:id/abandon` | confirm dialog with pending labels, invalidates detail + lists; composer disables off status |
| Check availability | `useConversationAvailabilityQuery` to `GET /:id/calendar/availability?start&end&timezone` | "Checking�", result line; errors show truthful copy + Retry |
| Book meeting | `useBookConversationMeetingMutation` to `POST /:id/calendar/book` | "Booking�", booking card (status, start/end, Meet link when returned); never auto-books |
| Open lead | router link | `GET /leads/:id` page |

### Loading states

Score now to "Scoring�"; Check availability to "Checking�"; Book meeting to
"Booking�"; Create to "Creating�"; Complete/Abandon confirms to
"Completing�"/"Abandoning�"; send to "Assistant is typing�" plus a disabled
composer. Triggers stay disabled while their mutation is pending.

### Error handling (`conversationErrorCopy` + `getCalendarBookingErrorMessage`)

- 401: "Your session has expired. Please sign in again." (plus Sign-in link)
- 403: "You don't have access to this conversation."
- 404: "Conversation not found."
- 409: "That action is not available for this conversation."
- 429: "Too many requests. Please wait and try again."
- Calendar 503: "Calendar booking is not configured. Connect Google
  Calendar to create a meeting."; calendar 403 (tier gate): tier
  ineligibility note. No raw transport errors, stack traces, or SQL.

### Meeting flow

Enter start/end (`datetime-local`) + timezone; inline validation (both
required, end after start, start in the future); Check availability;
result; Book meeting enabled only for the checked slot (editing any field
invalidates the previous check, so booking can never use a stale slot);
booking card with status/times/Meet URL (explicit "No meeting link was
returned" when absent). Abandoned conversations disable the panel with a
reason; sending to a completed conversation is rejected (409) with the
disabled-composer note.

## Customer-name display (Phase 13)

### Source

`GET /api/v1/conversations` attaches an additive safe lead summary per row
(`src/controllers/conversationController.ts`, single batched
`LeadRepository.findByIds` lookup, no duplicate customer table):

`lead: { id, name, phone, email, status } | null`

No extra lead fields leak. Unlinked conversations and deleted leads resolve
to `lead: null`. The detail endpoint already returned `{id, name, phone,
status}`; the list shape now matches it plus `email` for search.

### Display and fallback (`displayCustomerName` in `conversationView.ts`)

1. linked `lead.name`, 2. conversation state `customer_name` (detail header
only, via the shared state query cache), 3. `"Unnamed Lead"`. UUIDs are
never the visible name; the conversation id survives only as truncated
secondary metadata (`title` holds the full id).

- List row (`ConversationsPage.tsx`): customer name primary; sub-line shows
  the short id; status uses the formatted label (`Active/Completed/
  Abandoned`); tier signal unchanged (HOT/WARM/COLD).
- Detail header: same fallback chain; "View Lead" link still uses the raw
  `lead_id` for `/leads/:id`.
- Global search (`searchFilter.ts`) matches name/email/phone/id/channel/
  status and titles hits with the customer name.

### List presentation

Scoped `.conversations-table-card` styles: block name cell with ellipsis
(`max-width: 270px`, 170px on mobile), mono truncated-id sub-line, styled
`.pagination-row` matching `.table-footer`, wrapping toolbar; the table
scrolls horizontally inside the card below ~640px instead of crushing
columns. Rows are keyboard-operable (Enter/Space) with visible focus and an
"Open conversation with <name>" label; search, filters, and pagination
controls have accessible labels. Shared `Button` accepts `aria-label` (tiny
correction benefiting all icon-only buttons).

### Empty states

"No conversations yet." / "No qualification yet. Qualification will appear
when enough information is available." / "No logistics details yet." � no
debug wording. Logistics labels stay human-readable (Customer Name, Pickup,
Destination, Vehicle, Cargo, Weight, Dimensions, Required Date, Budget,
Urgency, Booking Intent).
