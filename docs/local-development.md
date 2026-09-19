# Local Development — MadVoice AI

Fixed, permanent local setup. After a Windows restart the whole workflow is one command.

## Prerequisites

- Node.js (backend `ts-node-dev`, launcher uses the `node` on PATH)
- PostgreSQL running locally with the database from `DATABASE_URL`
- Dependencies installed:
  - `npm install` (project root, backend)
  - frontend dependencies (`frontend/node_modules` via `npm install --prefix frontend` or `pnpm install` in `frontend/`)

## Required .env files (local-only, ignored by Git)

`.env` files are never committed (root `.gitignore` and `frontend/.gitignore` both ignore `.env`).

| File | Source | Key values |
| ---- | ------ | ---------- |
| `project-root/.env` | copy from `.env.example` | `PORT=4000`, `DATABASE_URL=…`, `AUTH_JWT_SECRET=…` (long random, server-only) |
| `frontend/.env` | copy from `frontend/.env.example` | `VITE_API_BASE_URL=http://localhost:4000` |

```powershell
Copy-Item .env.example .env
Copy-Item frontend\.env.example frontend\.env
```

Then edit `.env` and set a real `AUTH_JWT_SECRET` and your local `DATABASE_URL`.
Never put `AUTH_JWT_SECRET`, `JWT_SECRET`, or `DATABASE_URL` in any `frontend/.env` file —
`VITE_*` variables are embedded in the browser bundle and are public.

`OAUTH_SERVER_URL` is **not required** for local development. It belongs to the legacy
Manus-hosted preview login (`/api/oauth/callback`); local auth uses the Express backend
with first-party JWT + HttpOnly refresh cookie. Do not invent an OAuth server locally.

## Fixed ports

| Service | URL | Source |
| ------- | --- | ------ |
| Backend (Express) | `http://localhost:4000` | `PORT` in project-root `.env`, compiled default `4000` (`resolveBackendPort()` in `src/app.ts`) |
| Frontend (Vite / Manus dev server) | `http://localhost:3000` | `PORT=3000` in the `dev` script, `server.port = 3000` + `strictPort: true` in `frontend/vite.config.ts` |

Neither service silently switches ports. If port `3000` is occupied the frontend fails
fast with a clear error; the backend never falls back to `3000`.

## One-command startup

From the project root:

```powershell
npm run dev:all
```

The launcher (`scripts/dev-all.mjs`):

1. Checks `project-root/.env` and `frontend/.env` exist (names only — secrets never printed).
2. Starts the backend on `4000` and the frontend on `3000`.
3. If a port already serves a **healthy** instance, it reuses it instead of starting a duplicate.
4. If a port is occupied by something **unhealthy/unknown**, it prints the owning process
   (`netstat`/`tasklist` on Windows) and exits **without killing anything**.
5. Verifies health checks, then prints:

```text
Backend: READY
Frontend: READY
```

If the backend is unavailable it reports that clearly and stops.

## One-command shutdown

Press `Ctrl+C` in the launcher terminal. The launcher terminates only the child
processes it spawned (plus their trees) — never unrelated processes.

## Health checks

- Backend: `http://localhost:4000/health` → `{ "status": "ok", … }`
- Frontend: `http://localhost:3000` → HTTP 200

## Troubleshooting (only what has actually bitten us)

### Port already in use

The launcher prints the owner, e.g. `PID 1234: node.exe`. Stop that process, then:

```powershell
npm run dev:all
```

To inspect manually:

```powershell
netstat -ano | findstr ":4000"
tasklist /FI "PID eq <pid>"
```

### Auth endpoints return 500 (`POST /api/v1/auth/*`)

`AUTH_JWT_SECRET` is missing or blank in `project-root/.env` (the backend fails closed
by design). Set a long random value in `.env` and restart via `npm run dev:all`.
A blank inherited shell variable does not shadow `.env` in local development, but in
production real environment variables always win and blank counts as missing.

### Backend cannot reach PostgreSQL

Verify `DATABASE_URL` in `project-root/.env` and that the PostgreSQL service is
running (e.g. `Get-Service postgresql*` in an elevated PowerShell, or connect with
`psql`). The backend logs a connection error naming the host/port only — never
credentials.

### `OAUTH_SERVER_URL is not configured` message

Expected locally and harmless: it is a one-time warning (not an error) noting the
Manus preview login is disabled. Local JWT auth is unaffected. No action needed.
