# Admin vs Customer Access (Phase 20)

MadLead AI serves two strictly separated experiences from one backend. The
**backend** is the security boundary — frontend route hiding is convenience
only and proves nothing.

## Internal users (the admin application)

- **Identity:** rows in the `users` table (`ADMIN` | `USER`; there is no
  customer role there — customers are external leads, never users).
- **Session:** short-lived HS256 access JWT (`Authorization: Bearer …`) plus
  an opaque refresh token in the `mad_rt` HttpOnly cookie.
- **APIs:** everything under `/api/v1/*` **except** `/api/v1/auth/*`
  (login/register/refresh), `/api/v1/customer/*`, and `/health` requires an
  authenticated internal user (`requireAuth` + `requireRole`).
  - Both roles can use leads, owned conversation workflows, qualifications,
    follow-up scheduling/listing/per-item actions, CRM sync, WhatsApp reads,
    calendar operations, knowledge search/reads, dashboard, and n8n reads.
    Customer-access issuance/revocation is available to either role for an
    owned conversation.
  - `ADMIN`-only mutations: workspace settings PATCH, agent config
    PATCH/pause/resume, knowledge ingest, and batch follow-up execution
    (`POST /api/v1/followups/execute-due`).
- **Registration:** public signup always mints `USER`. After verifying
  account ownership, a deployment operator can promote an existing active
  account with `npm run admin:promote -- <existing-account-email>`.
- **Database upgrades:** `npm run migrate` records applied SQL in
  `schema_migrations`. Existing databases matching the complete 018 schema
  are baselined through 018 and then receive 019. Investigate any incomplete
  or drifted schema before retrying; the runner stops instead of replaying it.
- **UI:** all `/dashboard`, `/leads`, `/conversations`, `/qualifications`,
  `/followups`, `/crm`, `/whatsapp`, `/calendar`, `/ai-agent`, `/knowledge`,
  `/automation`, `/activity`, `/settings` routes sit behind `RequireAuth`.
  A customer session hitting them is redirected to `/chat`, never `/login`.

## Phase 21 additions (ADMIN vs USER)

- **Standard role is `USER`** (migration `019` renamed the Phase-20
  `OPERATOR` value in place; permissions unchanged). `ADMIN` is full
  control; `USER` is sales/operations.
- **Login entry `[Admin | User]` is intent, not authorization.** The server
  verifies the account role after credentials check: a `USER` account
  selecting Admin is rejected truthfully ("This account does not have Admin
  access.") and its just-created session is cleared. An `ADMIN` may enter
  either way with full account privilege. Registration always mints `USER`.
- **Frontend gating:** the sidebar hides genuinely unauthorized areas for
  `USER` (AI Agent, Knowledge Base, Automation, Activity, Notifications,
  Settings); `/settings`, `/ai-agent`, and `/knowledge/ingest` additionally
  require `RequireAdmin` (truthful unauthorized page, no redirect loop).
  The dashboard greets by time-of-day + session first name; Profile shows
  the server-verified role. The backend (`requireRole`) stays the real
  boundary in all cases.
- **User management UI is intentionally a next phase.** The backend role
  infrastructure (role column, normalization, `requireRole`, CLI promotion
  mechanism) exists now; no self-promotion path exists anywhere
  (`PATCH /auth/me` renames only — verified by tests).

## Customers (the external chat)

- **Identity:** a lead/conversation — never a user row, never an internal
  JWT. Access is granted per conversation only.
- **Share flow (internal owner only):**
  `POST /api/v1/conversations/:id/customer-access` (owner + internal role)
  mints a 256-bit random bearer token, stores **only its HMAC hash**, and
  returns `{ url: "<frontend>/chat/<token>", expiresAt }` exactly once.
  Re-sharing revokes the previous link so one live link exists per
  conversation. Revocation (`POST …/customer-access/revoke`) kills all
  tokens and sessions for the conversation; history is untouched.
- **Session flow:** `POST /api/v1/customer/session { accessToken }`
  (strictly rate-limited against guessing) mints an opaque session, sets the
  `mad_cs` HttpOnly cookie (`SameSite=Lax`, `Secure` in production), and
  returns only `{ conversation: { id, status, channel }, expiresAt }`. The
  frontend then drops the token from the URL (`/chat/:token` → `/chat`).
  `POST /api/v1/customer/logout` revokes and clears.
- **Scope:** `/api/v1/customer/*` resolves the conversation **exclusively**
  from the session cookie — no client-supplied conversation/lead/user id is
  ever trusted (no such routes exist). Allowed surface: own conversation
  summary, own messages (+send, same agent/orchestrator/tools/RAG as
  internal turns), own shipment state, own qualification, own meeting
  availability/booking, logout. Everything else (lead lists, other
  conversations, qualifications, CRM, WhatsApp admin, settings, agent
  config, knowledge, activity, dashboard) is unreachable: those routers
  demand an internal JWT the customer never holds.
- **UI:** `/chat/:token` and `/chat` render a minimal shell (no sidebar, no
  admin navigation) with the composer, shipment details, qualification
  (when present), and meeting section.

## Threat notes

- Token/session values are 256-bit random, HMAC-hashed at rest, expiring,
  revocable, and never logged. Raw access tokens appear once (the share
  URL) and are never re-readable.
- Failed redeems, expired/revoked grants, and missing sessions all fail
  closed with generic 401s (no enumeration).
- Stores are single-process memory for rate limits/idempotency (documented
  horizontal-scaling limitation, unchanged from prior phases).
