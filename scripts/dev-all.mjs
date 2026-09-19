/**
 * MadVoice AI — one-command local development launcher.
 *
 * From the project root:
 *   npm run dev:all
 *
 * Starts:
 *   Backend  → http://localhost:4000 (project-root/.env, PORT=4000)
 *   Frontend → http://localhost:3000 (frontend/.env, PORT=3000)
 *
 * Behaviour:
 * - If a port is already serving a HEALTHY instance of that service, the
 *   launcher reuses it (no duplicate server) and reports it.
 * - If a port is occupied by something unhealthy/unknown, the launcher
 *   reports the owning process and exits WITHOUT killing anything.
 * - Child processes are terminated cleanly when the launcher exits
 *   (Ctrl+C). Only processes spawned by this launcher are ever signalled.
 * - No secret values are ever printed (names/status only).
 *
 * Windows PowerShell compatible: plain `node scripts/dev-all.mjs`, no
 * shell-specific syntax, no execution-policy friction.
 */
import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execAsync = promisify(exec);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 4000);
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 3000);
const BACKEND_HEALTH = `http://localhost:${BACKEND_PORT}/health`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}/`;
const STARTUP_TIMEOUT_MS = Number(process.env.DEV_ALL_TIMEOUT_MS || 120000);
const POLL_INTERVAL_MS = 1500;

const children = [];

/** True when something is listening on the port (regardless of owner). */
function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
    socket.connect(port, "127.0.0.1");
  });
}

/** Best-effort owner report for an occupied port. Never kills anything. */
async function describePortOwner(port) {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execAsync(
        `netstat -ano | findstr /R /C:":${port} .*LISTENING"`
      );
      const lines = stdout.trim().split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return "owner unknown (listening socket not listed)";
      const pids = [...new Set(lines.map((l) => l.split(/\s+/).pop()))];
      const owners = [];
      for (const pid of pids) {
        try {
          const { stdout: t } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO TABLE /NH`);
          owners.push(`PID ${pid}: ${t.trim().split("\n")[0]?.trim() || "unknown image"}`);
        } catch {
          owners.push(`PID ${pid}: (details unavailable)`);
        }
      }
      return owners.join(" | ");
    }
    try {
      const { stdout } = await execAsync(`lsof -iTCP:${port} -sTCP:LISTEN -Pn`);
      return stdout.trim().split("\n").slice(0, 4).join(" | ");
    } catch {
      const { stdout } = await execAsync(`ss -ltnp 'sport = :${port}'`);
      return stdout.trim().split("\n").join(" | ") || "owner unknown";
    }
  } catch {
    return "owner unknown (could not inspect listeners)";
  }
}

async function fetchHealth(url, expectJsonOk) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    if (!expectJsonOk) return true;
    const body = await res.json().catch(() => null);
    return body?.status === "ok";
  } catch {
    return false;
  }
}

async function waitForHealthy(name, url, expectJsonOk, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetchHealth(url, expectJsonOk)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

function checkEnvFiles() {
  const rootEnv = path.join(ROOT, ".env");
  const frontendEnv = path.join(ROOT, "frontend", ".env");
  if (!fs.existsSync(rootEnv)) {
    console.error(
      `[dev:all] Missing project-root/.env — copy it from .env.example and fill in ` +
        `PORT=4000, DATABASE_URL and AUTH_JWT_SECRET (see docs/local-development.md).`
    );
    process.exitCode = 1;
  }
  if (!fs.existsSync(frontendEnv)) {
    console.error(
      `[dev:all] Missing frontend/.env — copy it from frontend/.env.example ` +
        `(VITE_API_BASE_URL=http://localhost:4000).`
    );
    process.exitCode = 1;
  }
  if (process.exitCode === 1) process.exit(1);
}

function spawnService(name, args, extraEnv, logPrefix) {
  // shell:true lets `npm` resolve to npm.cmd on Windows.
  const child = spawn("npm", args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (d) =>
    process.stdout.write(d.toString().split("\n").map((l) => (l ? `${logPrefix}${l}` : l)).join("\n"))
  );
  child.stderr.on("data", (d) =>
    process.stderr.write(d.toString().split("\n").map((l) => (l ? `${logPrefix}${l}` : l)).join("\n"))
  );
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[dev:all] ${name} exited with code ${code}.`);
    } else if (signal) {
      console.error(`[dev:all] ${name} exited via signal ${signal}.`);
    }
  });
  return child;
}

/** Terminate ONLY processes spawned by this launcher (plus their trees). */
async function shutdown() {
  if (children.length === 0) return;
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        if (process.platform === "win32") {
          // /T kills the tree rooted at OUR child only — never unrelated PIDs.
          await execAsync(`taskkill /PID ${pid} /T /F`).catch(() => {});
        } else {
          child.kill("SIGINT");
          await new Promise((r) => setTimeout(r, 3000));
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }
      } catch {
        /* best effort */
      }
    })
  );
}

let shuttingDown = false;
async function handleSignal(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[dev:all] Received ${signal} — stopping child processes…`);
  await shutdown();
  process.exit(0);
}
process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));

async function ensureService({ name, port, healthUrl, expectJsonOk, spawnArgs, spawnEnv, logPrefix }) {
  if (await isPortOpen(port)) {
    if (await fetchHealth(healthUrl, expectJsonOk)) {
      console.log(`[dev:all] Port ${port} already serves a healthy ${name} — reusing it (no duplicate started).`);
      return true;
    }
    const owner = await describePortOwner(port);
    console.error(
      `[dev:all] Port ${port} is occupied but is NOT a healthy ${name} (${owner}).\n` +
        `  Stop that process and run \`npm run dev:all\` again. Nothing was killed.`
    );
    return false;
  }
  console.log(`[dev:all] Starting ${name} on port ${port}…`);
  spawnService(name, spawnArgs, spawnEnv, logPrefix);
  const ok = await waitForHealthy(name, healthUrl, expectJsonOk, STARTUP_TIMEOUT_MS);
  if (!ok) {
    console.error(
      `[dev:all] ${name} did not become healthy at ${healthUrl} within ${STARTUP_TIMEOUT_MS / 1000}s. ` +
        `Check the ${name} logs above.`
    );
    return false;
  }
  return true;
}

async function main() {
  console.log("[dev:all] MadVoice AI local development launcher");
  console.log(`[dev:all] Root: ${ROOT}`);
  checkEnvFiles();

  const backendOk = await ensureService({
    name: "backend",
    port: BACKEND_PORT,
    healthUrl: BACKEND_HEALTH,
    expectJsonOk: true,
    spawnArgs: ["run", "dev"],
    spawnEnv: { PORT: String(BACKEND_PORT) },
    logPrefix: "[backend] ",
  });

  const frontendOk = await ensureService({
    name: "frontend",
    port: FRONTEND_PORT,
    healthUrl: FRONTEND_URL,
    expectJsonOk: false,
    spawnArgs: ["run", "dev", "--prefix", "frontend"],
    spawnEnv: { PORT: String(FRONTEND_PORT) },
    logPrefix: "[frontend] ",
  });

  console.log("");
  console.log(`Backend: ${backendOk ? "READY" : "NOT AVAILABLE"} (${BACKEND_HEALTH})`);
  console.log(`Frontend: ${frontendOk ? "READY" : "NOT AVAILABLE"} (${FRONTEND_URL})`);

  if (!backendOk) {
    console.error("[dev:all] Backend is unavailable — fix the backend errors above, then re-run `npm run dev:all`.");
    await shutdown();
    process.exit(1);
  }
  if (!frontendOk) {
    console.error("[dev:all] Frontend is unavailable — fix the frontend errors above, then re-run `npm run dev:all`.");
    await shutdown();
    process.exit(1);
  }

  console.log("[dev:all] Both services are up. Press Ctrl+C to stop everything (one-command shutdown).");
  // Keep the launcher alive while children run.
  await new Promise(() => {});
}

main().catch(async (err) => {
  console.error("[dev:all] Fatal error:", err?.message || err);
  await shutdown();
  process.exit(1);
});
