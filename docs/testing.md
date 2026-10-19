# Testing strategy (Phase 5)

Three tiers. Fast tiers run everywhere with no credentials; the live tier
needs only a local PostgreSQL server and never touches application data.

## Tier 1 — fast deterministic tests (no credentials, no network)

Backend (Jest, `ts-jest`, mocked `pg` pool — no database required):

| Command | Suites |
|---|---|
| `npm run check` | Backend TypeScript (`tsc --noEmit`) |
| `npm run test:auth` | Login/register/refresh/logout, roles, customer isolation |
| `npm run test:workflows` | Leads, conversations, qualifications, follow-ups, calendar, dashboard aggregates |
| `npm run test:integrations` | CRM/WhatsApp/n8n/Knowledge diagnostics and senders (mocked providers), settings, agent health |
| `npm test` | Full Jest suite (`src/tests/**/*.test.ts`) — slow (many suites); prefer the focused commands above and report exactly what ran |

Frontend (Vitest; `frontend/` directory):

| Command | Suites |
|---|---|
| `npm run check --prefix frontend` | Frontend TypeScript (`tsc --noEmit`) |
| `npm run test --prefix frontend` | Full Vitest run (`vitest run`, 38 files) — ~1 min |

Test-environment shims live in `frontend/client/src/test-setup.ts`
(`ResizeObserver`, `Element.scrollIntoView` no-ops for jsdom). They are
stateless and hold no cross-test state. Markdown rendering (`streamdown` →
KaTeX CSS) is stubbed per-file where route behavior — not typography — is
under test, following the convention in `AIChatBox.test.tsx`.

Conventions: network is mocked at `fetch` only; fixtures must match the
real API contracts (canonical `ADMIN`/`USER` roles — the session layer
fail-closes on anything else); every async test cleans up with
`afterEach(cleanup)` and `vi.unstubAllGlobals()` / `resetSessionForTests()`
where applicable. Do not weaken assertions or skip failing tests to go
green.

## Tier 2 — live PostgreSQL migration verification (optional, local only)

`npm run test:migrations:live` runs `scripts/verify-migrations-live.cjs`:

- Aborts unless `DATABASE_URL` (repo `.env`) points at `localhost` /
  `127.0.0.1`. Never point it at a shared or production database.
- Creates and drops ONLY scratch databases named `madlead_p5_*` via the
  maintenance `postgres` database. The application database is never
  migrated, written, or read.
- Verifies with the real runner: fresh install (19 ledger rows, tables,
  `ADMIN`/`USER` CHECK, invalid-role rejection, idempotent re-run);
  legacy-018 baseline with representative rows (`OPERATOR`→`USER`
  mapping, stable ids, intact relationships); checksum-drift failure;
  broken-migration failure with no ledger row; concurrent runners
  serialized by the advisory lock.

Windows PowerShell (from the repo root):

```powershell
# 1. Confirm a local PostgreSQL is listening (informational only)
Test-NetConnection -ComputerName localhost -Port 5432

# 2. Run the verification (safe: localhost-only guard + scratch DBs)
npm run test:migrations:live
```

Expected output ends with `MIGRATION VERIFICATION: ALL PASS` (19 checks:
A1–A7, B1–B7, C1–C3, D1). Any `FAIL` line names the exact check.

elevation to start). Adding an unrunnable harness plus lockfile churn
guard, redirect, and error state without a browser.
## Tier 3 — browser end-to-end

Playwright is the single browser-level framework. The real-service suite is
under `e2e/` and requires an explicitly named disposable local database via
`E2E_DATABASE_URL`; setup seeds test identities and teardown removes only
`e2e-*` records. See `docs/e2e.md` for the command and provider settings.

The suite covers ADMIN and USER auth/authorization, customer chat redemption
and isolation, lead/conversation/qualification/follow-up/dashboard records,
invalid sessions, and truthful API failure UI. It must not be replaced by
fetch-mocked component tests.

When a database-backed environment is available, the justified minimal
addition is Playwright alone (`@playwright/test`, one framework) with
these flows against `http://localhost:3000` + `http://localhost:4000`
using seeded test identities on a disposable database — never production
records or credentials:

- **A (ADMIN):** log in as seeded ADMIN → session/workspace loads →
  dashboard, Settings, AI Agent, Knowledge Ingest reachable → search
  follows ADMIN policy → logout → protected content gone.
- **B (USER):** log in as seeded USER → shared pages load → direct nav to
  `/settings`, `/ai-agent`, `/knowledge/ingest` denied in UI *and* 403/401
  from the API → search hides admin destinations → logout clears state.
- **C (public chat):** logged out → redeem test share link → send message →
  real backend reply/qualification → second session cannot read the first →
  expired/invalid token rejected.
- **D (lead workflow):** create lead → appears in list/detail → qualify via
  conversation → follow-up scheduled → dashboard aggregates change →
  cancel/retry paths → provider failure never reported as success.
- **E (errors):** invalid login → generic error; bad record URL → Not
  Found; backend stopped → error states (never stale-as-fresh); expired
  session → protected UI cleared.

Use accessible role/name/label selectors (never CSS classes). Do not
present today's fetch-mocked component tests as browser E2E.
