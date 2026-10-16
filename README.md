# MadLead AI — Text-First Lead Qualification System

## Overview

A modular system for AI‑driven lead qualification tailored for logistics &
transport companies. Text conversations are the primary AI interaction model
(the legacy voice/Vapi system is retired):

- Capture leads and converse with them over real-time text chat (web).
- Conduct multilingual conversations (Tamil, Hindi, English) via the LLM agent.
- Qualify leads (HOT/WARM/COLD) and store all data in PostgreSQL.
- Integrate with CRM, Google Calendar/Meet, WhatsApp and n8n for automation.

> Release status is decided per phase by evidence, not by this file. See the
> release-gate table in the Phase 6 report and `docs/deployment.md` for the
> deployment checklist. Do not treat a green build as production approval.

## Quick Start (local development)

```powershell
cd ai-voice-lead-qualification

# Install dependencies (backend + frontend)
npm install
npm install --prefix frontend   # or: pnpm install (in frontend/)

# Copy example envs and fill in local values (never commit .env files)
Copy-Item .env.example .env
Copy-Item frontend\.env.example frontend\.env
```

| File | Key values |
| ---- | ---------- |
| project-root `.env` | `PORT=4000`, `DATABASE_URL=…`, `AUTH_JWT_SECRET=…` (long random, server-only) |
| `frontend/.env` | `VITE_API_BASE_URL=http://localhost:4000` (public URL only, never secrets) |

```powershell
# Start backend (4000) + frontend (3000)
npm run dev:all
```

Backend health: `GET http://localhost:4000/health`. Details, ports, and
troubleshooting: `docs/local-development.md`.

## Project Structure

```
ai-voice-lead-qualification/
├─ src/                  # Backend (Express + TypeScript)
│  ├─ agent/             # Text-first agent: orchestrator, RAG, LLM, tools
│  ├─ config/            # Configuration loaders (env bootstrap first)
│  ├─ controllers/       # Request handling logic
│  ├─ database/          # Pool, migrate.ts, migrations/ (001–019 ledger)
│  ├─ middleware/        # Auth, roles, guards, rate limits, validation
│  ├─ models/            # Row types
│  ├─ repositories/      # SQL persistence (no business logic)
│  ├─ routes/            # Express route definitions (/api/v1/*)
│  ├─ scripts/           # Operator CLIs (admin:promote) + migration verifier
│  ├─ services/          # Business logic & integrations
│  ├─ tests/             # Jest suites (mocked pool; no live DB required)
│  └─ utils/             # Helpers
├─ frontend/             # SPA (Vite + React, builds to frontend/dist/public)
│  ├─ client/src/        # Pages, components, API layer, guards, tests
│  └─ server/            # Contract/search tests (no production server)
├─ scripts/              # Dev launcher (dev-all.mjs)
├─ docs/                 # Architecture, testing, deployment guides
├─ .env.example          # Backend env template (placeholders only)
├─ package.json          # Backend scripts (test:auth/:workflows/:integrations/:migrations:live)
└─ README.md
```

## Testing

```powershell
npm run check                        # backend typecheck
npm run test:auth                    # login/register/roles/customer isolation
npm run test:workflows               # leads, conversations, follow-ups, calendar, dashboard
npm run test:integrations            # providers (mocked), settings, agent health
npm run test:migrations:live        # real-PostgreSQL migration checks (localhost scratch DBs only)
npm run check --prefix frontend      # frontend typecheck
npm run test --prefix frontend       # full Vitest suite
```

Strategy, tiers, and the suites excluded from default commands:
`docs/testing.md`.

## Deployment

No provider is pre-configured. Supported topology, required/optional
environment, migration sequencing, health checks, and rollback:
`docs/deployment.md`.

## Product limitations (by design, not defects to work around)

- Password recovery is unavailable (honest limitation page; no reset emails).
- Email verification is not required under the current policy.
- No notification store exists (Notifications page says so explicitly).
- Dashboard shows current backend totals only — no historical trends.
- CRM/WhatsApp/Calendar/n8n/LLM features require valid deployment
  configuration and report `not_configured` otherwise.

## First administrator

Public registration always mints `USER`. Promote an existing verified
account (operator-run, against the intended database only):

```powershell
npm run admin:promote -- <existing-account-email>
```

For detailed architecture, see `docs/architecture.md`.
