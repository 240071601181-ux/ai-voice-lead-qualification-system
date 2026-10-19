# Browser E2E Verification

The repository uses Playwright as its only browser-level test framework.
The suite drives the real frontend at `http://localhost:3000` and the real
Express API at `http://localhost:4000`; it does not mock application APIs.

## Safe environment

Set `E2E_DATABASE_URL` explicitly before running. The global setup refuses
remote hosts and refuses database names that do not match
`madlead_e2e_<suffix>`. It runs the real migration runner, seeds two temporary
identities and a lead, and writes state only under ignored `test-results/`.
The global teardown removes `e2e-*` leads, follow-ups, and seeded users. Never
point this variable at the normal application database or a production URL.

The default qualification test uses the configured local Ollama provider. To
use another controlled provider, set `E2E_LLM_PROVIDER`, `E2E_LLM_MODEL`, and
`E2E_LLM_BASE_URL`; `mock` is intentionally not the default and should not be
reported as live-provider coverage.

## Command

From the repository root, with a disposable local database created and the
PostgreSQL service running:

```powershell
$env:E2E_DATABASE_URL = 'postgres://user:password@localhost:5432/madlead_e2e_phase7'
npm.cmd run test:e2e
```

Playwright launches or reuses the local backend and frontend. Chromium must be
installed with `npx playwright install chromium`. The suite includes desktop
and mobile projects and records JSON output, screenshots, traces, and videos
only under ignored `test-results/`.

## Workflows covered

- ADMIN login, dashboard, admin settings route, profile logout.
- USER login, shared leads route, admin-only denial, profile logout.
- Invalid credentials, invalid session redirect, and failed API error state.
- Lead creation, real conversation message, qualification persistence,
  follow-up persistence, and dashboard summary.
- Public customer link redemption, message submission, and second-context
  session isolation.

A run that cannot start because PostgreSQL, services, the configured provider,
or Chromium is unavailable is blocked and must be reported as such. A mocked
component test is not a browser E2E pass.
