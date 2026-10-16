# Deployment — MadLead AI

No deployment provider (Docker, PaaS manifest, or VM image) is configured
in this repository. Deploy using the generic two-service topology below on
any host that can run Node.js 20+ and reach PostgreSQL.

## Architecture

```
                ┌──────────────────────────────┐
                │  Static host / CDN           │
                │  frontend/dist/public        │  serves index.html +
                │  (SPA fallback required)     │  /assets/*, NO /api/*
                └──────────────┬───────────────┘
                               │  VITE_API_BASE_URL=https://api.example.com
                ┌──────────────▼───────────────┐
                │  Node.js service             │
                │  node dist/app.js (PORT)     │  Express API + /health
                └──────────────┬───────────────┘
                               │  DATABASE_URL (pool, migrations separate)
                ┌──────────────▼───────────────┐
                │  PostgreSQL 14+              │
                └──────────────────────────────┘
```

- The backend does **not** serve frontend assets (no `express.static` in
  `src/app.ts`). API paths must reach the backend; the static host must
  return `index.html` for all non-`/api/*` routes (verified pattern in
  Step 4 smoke test).
- Frontend and backend are separate origins by default: the browser sends
  `credentials: "include"` with API requests, so CORS and cookies must be
  configured together (below).

## Build

```powershell
npm install            # root (backend)
npm install --prefix frontend   # or: pnpm install (frontend/ has pnpm-lock.yaml)
npm run build          # backend: tsc -> dist/app.js
npm run build --prefix frontend # client: vite build -> frontend/dist/public (+ template server bundle dist/index.js, not used by this topology)
```

Verified artifacts: `dist/app.js` (backend entry), `frontend/dist/public/index.html`
+ `assets/*` (frontend). `dist/` is gitignored — build on the deploy host
or in CI, never commit build output.

## Required configuration (backend environment)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://user:password@host:5432/db`. Pool connects lazily; missing/invalid fails at first query, never at import. |
| `AUTH_JWT_SECRET` | yes | Long random server-only secret. Missing/blank → `POST /api/v1/auth/*` fail closed (500) with a startup warning naming the variable only. |
| `PORT` | no | Default `4000`. Invalid values fall back to `4000` (never the frontend port). |
| `FRONTEND_ORIGIN` / `FRONTEND_ORIGINS` | yes in production | Exact allowed origins, e.g. `https://app.example.com`. Production (`NODE_ENV=production`) allows **no** origins unless set — dev defaults (`localhost:3000/3001/5173`) are dropped. No wildcards; credentials preserved. |
| `NODE_ENV=production` | yes | Enables `Secure` cookies, drops dev CORS defaults. |

Optional providers (all default disabled; missing credentials render a
truthful not-configured state — never fake connectivity): `CRM_SYNC_ENABLED`
+ `CRM_*`, `WHATSAPP_ENABLED` + `WHATSAPP_*` (+ `WHATSAPP_TEMPLATES_JSON`),
`CALENDAR_ENABLED` + `GOOGLE_*`, `N8N_ENABLED` + `N8N_WEBHOOK_URL`/`N8N_WORKFLOWS_JSON`
+ `N8N_WEBHOOK_SECRET`, `FOLLOWUP_ENABLED` + `FOLLOWUP_*`, `LLM_PROVIDER`
(`ollama` default when unset — requires a reachable Ollama + `LLM_MODEL`;
`openai` needs `LLM_API_KEY`; `mock` is tests-only and logs a warning),
`EMBEDDING_*`, chat/rate-limit tunables, customer-session TTLs/cookie
names, refresh TTLs/cookie name. Full inventory: `.env.example` (placeholders
only) and Step 5 of the Phase 6 report.

Frontend build-time: `VITE_API_BASE_URL=https://api.example.com` (public,
baked into the bundle — URL only, never secrets).

## Database sequencing (staging/production)

```powershell
# 1. Back up the target database first (pg_dump), then, against a STAGING
#    copy, verify migrations before touching production:
npm run test:migrations:live   # localhost-only guard; scratch DBs only

# 2. Migrate the real target explicitly (never automatic on boot):
npm run migrate
```

`npm run migrate` is idempotent (ledger + advisory lock + per-migration
transactions + checksum drift detection). If it reports drift, reconcile
`schema_migrations` manually — never edit an applied migration file.
First ADMIN account: `npm run admin:promote -- <existing-account-email>`
(operator-run, existing verified account only).

## Cookies, CORS, HTTPS

- Refresh cookie (`mad_rt` default) and customer cookie (`mad_cs` default):
  `HttpOnly`, `SameSite=Lax`, `Secure` in production. Serve everything over
  HTTPS in production; cross-origin API calls require the exact frontend
  origin in `FRONTEND_ORIGINS` (no wildcard) with `Access-Control-Allow-Credentials`.
- No CSRF tokens: internal auth uses `Authorization: Bearer` (not cookies)
  for API calls; the refresh cookie is POST-only and its response body is
  unreadable cross-origin without CORS consent.
- Security headers (`helmet`, HSTS, `X-Content-Type-Options`,
  `X-Frame-Options`) are NOT set by the app — terminate behind a reverse
  proxy that adds them, or add `helmet` before any internet exposure.
  `X-Powered-By` is still emitted (minor; disable in proxy or app).

## Health / readiness and smoke test

- Liveness: `GET /health` → `{ "status": "ok", timestamp }` (no DB, no secrets).
- Readiness is NOT separated: `/health` stays `ok` while dependencies are
  down. Verify readiness explicitly: `GET /api/v1/crm/diagnostics`,
  `/api/v1/whatsapp/diagnostics`, `/api/v1/calendar/diagnostics`,
  `/api/v1/n8n/diagnostics` (require a session; report `ok` /
  `not_configured` / `error` honestly).
- Post-deploy smoke: `/health` 200 → unauthenticated `/api/v1/leads` 401 →
  login with bad credentials 401 generic → `index.html` served for
  `/leads/abc` and never for `/api/*`.

## Rollback

- Migrations are additive-only through 019 (no destructive DDL), so
  rollback is normally: redeploy the previous `dist/` + `dist/public`,
  no database downgrade. If a future migration ever becomes destructive,
  restore the pre-migration `pg_dump` instead — there is no down-migration
  runner.
- Keep the previous build artifacts until the new deployment passes the
  smoke test above.

## Known limitations (do not deploy around them silently)

Password recovery is unavailable (honest limitation page, no email flow);
email verification is not required; there is no notification store;
dashboard shows current totals only (no historical trends); follow-up
execution needs `FOLLOWUP_ENABLED` + provider configuration; customer chat
needs an LLM provider reachable (`ollama` default).
