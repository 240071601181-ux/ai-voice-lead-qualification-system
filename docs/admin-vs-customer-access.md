# Admin vs Customer Access (Phase 20)

MadLead AI serves two strictly separated experiences from one backend. The
**backend** is the security boundary — frontend route hiding is convenience
only and proves nothing.

## Internal users (the admin application)

- **Identity:** rows in the `users` table (`ADMIN` | `OPERATOR`; there is no
  customer role there — customers are external leads, never users).
- **Session:** short-lived HS256 access JWT (`Authorization: Bearer …`) plus
  an opaque refresh token in the `mad_rt` HttpOnly cookie.
- **APIs:** everything under `/api/v1/*` **except** `/api/v1/auth/*`
  (login/register/refresh), `/api/v1/customer/*`, and `/health` requires an
  authenticated internal user (`requireAuth` + `requireRole`).
  - Every internal role (`ADMIN`, `OPERATOR`) may use daily APIs: leads,
    conversations (with existing per-user ownership), qualifications,
    follow-ups, CRM, WhatsApp, calendar, knowledge search, dashboard, n8n.
  - `ADMIN`-only: global-configuration writes (workspace settings PATCH,
    agent config PATCH/pause/resume, knowledge ingest) and customer-access
    issuance/revocation.
- **Registration:** public signup always mints `OPERATOR`. The deployer
  names exactly one bootstrap address via `BOOTSTRAP_ADMIN_EMAIL`; existing
  rows default to `OPERATOR` — promote explicitly:
  `UPDATE users SET role = 'ADMIN' WHERE email = '…';`
- **UI:** all `/dashboard`, `/leads`, `/conversations`, `/qualifications`,
  `/followups`, `/crm`, `/whatsapp`, `/calendar`, `/ai-agent`, `/knowledge`,
  `/automation`, `/activity`, `/settings` routes sit behind `RequireAuth`.
  A customer session hitting them is redirected to `/chat`, never `/login`.

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
