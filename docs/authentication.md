# Authentication & Conversation Ownership (Phase 11)

Replaces the temporary pasted-CHAT_JWT workflow with real first-party
authentication. Prior state: UI-only demo session (localStorage flag, no
verification) plus an unverifiable platform cookie; the Express backend had
no users at all.

## User identity

`users` (migration 017, additive): UUID id, unique email, bcrypt hash
(12 rounds, never stored/returned/logged in plaintext), name, status,
timestamps. `user_sessions`: opaque 256-bit refresh tokens stored as
SHA-256 hashes, with expiry and revocation.

## Login/session flow

- `POST /api/v1/auth/register` — validates email/password (8–128 chars),
  rejects duplicates (409, race-safe), returns `{ user, accessToken,
  accessExpiresAt }` + HttpOnly refresh cookie. Never returns hashes.
- `POST /api/v1/auth/login` — generic 401 on bad credentials (no user
  enumeration), brute-force guarded (10/10min per IP → truthful 429).
- `POST /api/v1/auth/refresh` — rotates the refresh token (old revoked),
  returns a fresh access token. No cookie → 401.
- `POST /api/v1/auth/logout` — revokes the session, clears the cookie.
- `GET /api/v1/auth/me` — bearer-guarded, returns the safe user.

## Cookies/tokens

- Access: HS256 JWT, server-only `AUTH_JWT_SECRET`, 15-minute default,
  `iss`/`aud` validated, `sub` = user id. Sent as `Authorization: Bearer`.
- Refresh: HttpOnly, `SameSite=Lax`, `Secure` in production, path-scoped to
  `/api/v1/auth`, 7-day default. The SPA cannot read it; the browser sends
  it automatically (`credentials: "include"`).
- Frontend keeps the access token in module memory only (never
  localStorage/sessionStorage/source). Reload restores via exactly one
  refresh attempt; logout clears memory + revokes server-side + drops
  cached conversation rows so the next login cannot see them.

## Authorization

`requireAuth` verifies the access token and a live `active` user row, then
sets `req.user = { id, email }`. Missing/malformed/expired/invalid →
truthful 401, no leaks.

Conversation routes resolve identity (`resolveConversationIdentity`):
access JWT → user; otherwise the legacy pasted CHAT_JWT → legacy scope
(dev/test only, forced off when `NODE_ENV=production`). Every `:id` route
then runs `requireOwnedConversation`: users see only rows with
`user_id = <their id>`; legacy tokens see only `user_id IS NULL` rows;
anything else is a resource-hiding 404. Lists are scoped the same way.
Internal service callers (auto-qualify, fan-out) use unscoped lookups on
already-trusted ids.

## Conversation ownership

`conversations.user_id` (migration 017, nullable). New rows store the
creator's id (or NULL for the legacy dev fallback). Existing rows keep
`user_id NULL` and are ISOLATED — never silently assigned, invisible to
authenticated users, reachable only through the legacy dev scope. Leads stay
global (single-company assumption, documented here rather than overbuilt
into fake multi-tenancy).

## Logout

Revokes the refresh session, clears the cookie, drops in-memory and cached
conversation state. A logged-out refresh cookie is useless (revoked).

## Local development prerequisite

Auth endpoints fail closed with `500 Authentication is not configured` when
`AUTH_JWT_SECRET` is unset — the login screen then shows its generic server
error. Set a long random `AUTH_JWT_SECRET` in the backend `.env` (see
`.env.example`) and restart the server. This is operational configuration,
never code, and the secret must never be committed or shipped to the browser.

## Security assumptions

- `AUTH_JWT_SECRET` and `CHAT_JWT_SECRET` are long, random, server-only,
  and distinct; rotation invalidates sessions/tokens (documented, accepted).
- Single-tenant: any authenticated user may read any lead; conversation
  isolation is per-user as above. True per-workspace tenancy is out of scope
  (explicitly not claimed).
- Nothing sensitive is logged: no passwords, tokens, hashes, or secrets in
  logs, rows, or responses (asserted in tests).
