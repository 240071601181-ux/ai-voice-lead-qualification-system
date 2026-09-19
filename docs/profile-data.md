# Authenticated Profile Data (Phase 17)

## Source

`GET /api/v1/auth/me` (Bearer access token, `requireAuth`) returns the real
backend user (`SafeUser`: `id`, `email`, `name | null`, `status`,
timestamps — never `password_hash`). The SPA's single session source is
`useSessionQuery` (refresh-cookie restore, 5-minute stale time); Profile,
sidebar, header, and account menu all read it — no duplicated constants.

## Display rules (`components/app/userDisplay.ts`)

- **Initials** `userInitials(name)`: first two letters of the trimmed name,
  uppercased (`Santhosh` → `SA`); one letter for one-character names; `"U"`
  only when no name exists. Used identically in sidebar, header, profile.
- **Name** `displayUserName(name)`: trimmed name or `"Unnamed User"`.
- **Email**: real value or `"—"`. **Role**: no backend column → `"Role not
  set"`. **Workspace**: no backend column → `"Workspace not set"`.

## Persistence

`PATCH /api/v1/auth/me` accepts **only** `{ name }` (non-empty, ≤255
chars). The repository updates exactly one column; id/email/password_hash/
status/ownership can never change through this route (tested: protected
fields in the body are ignored). Success reseeds the session cache, so
profile/sidebar/avatar update immediately and survive reloads via the
normal refresh flow. Email is read-only in the UI.
