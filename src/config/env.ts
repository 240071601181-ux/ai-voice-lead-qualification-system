/**
 * Central environment bootstrap.
 *
 * MUST be imported before any module that reads process.env (first import
 * in src/app.ts, src/config/index.ts, src/database/index.ts).
 *
 * Guarantees:
 * - .env is resolved reliably (cwd first, then walk up from this file's
 *   directory so compiled dist/app.js works too).
 * - Loaded BEFORE configuration is consumed (import-time side effect; this
 *   module has no local imports so it executes first in the import chain).
 * - Production environment variables retain precedence over .env
 *   (dotenv never overrides by default; we only clear a *blank*
 *   inherited AUTH_JWT_SECRET in non-production so a valid local .env
 *   value is not shadowed by an empty shell variable).
 * - No secrets are ever logged (diagnostics report SET/MISSING + length).
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const AUTH_KEY = 'AUTH_JWT_SECRET';

/** Value inherited from the parent process BEFORE dotenv ran. */
const inheritedAuthJwt: string | undefined =
  Object.prototype.hasOwnProperty.call(process.env, AUTH_KEY)
    ? process.env[AUTH_KEY]
    : undefined;

const inheritedPresent = inheritedAuthJwt !== undefined;
const inheritedBlank =
  inheritedPresent &&
  (inheritedAuthJwt as string).trim().length === 0;

export const isProduction = process.env.NODE_ENV === 'production';

// dotenv does not override existing vars. A blank inherited value
// (e.g. `$env:AUTH_JWT_SECRET = ""` in PowerShell) would shadow a valid
// local .env entry forever. In local development only, drop the blank so
// .env can populate it. Production keeps strict precedence (fail closed).
if (!isProduction && inheritedPresent && inheritedBlank) {
  delete process.env[AUTH_KEY];
}

/**
 * Resolve the .env file reliably:
 * 1. process.cwd()/.env (covers `npm run dev` / `npm start` from root).
 * 2. Walk up from this module's directory (covers dist/config/env.js and
 *    any other cwd, e.g. running node dist/app.js from elsewhere).
 */
export const resolveEnvPath = (startDir: string = __dirname): string => {
  const fromCwd = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(fromCwd)) return fromCwd;
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.resolve(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fromCwd;
};

const resolvedEnvPath = resolveEnvPath();
const envExists = fs.existsSync(resolvedEnvPath);

// Load exactly once per process (multiple modules import this bootstrap).
declare global {
  // eslint-disable-next-line no-var
  var __envBootstrapLoaded: string | undefined;
}

let dotenvError: string | null = null;
let dotenvLoaded = false;

if (global.__envBootstrapLoaded !== resolvedEnvPath) {
  if (envExists) {
    const result = dotenv.config({ path: resolvedEnvPath });
    if (result.error) {
      dotenvError = result.error.message;
    } else {
      dotenvLoaded = true;
    }
  } else {
    dotenvError = `.env not found at ${resolvedEnvPath}`;
  }
  global.__envBootstrapLoaded = resolvedEnvPath;
} else {
  dotenvLoaded = true;
}

export interface EnvDiagnostics {
  cwd: string;
  resolvedEnvPath: string;
  envExists: boolean;
  dotenvLoaded: boolean;
  dotenvError: string | null;
  /** SET/MISSING only — never the value. */
  authJwtSecret: 'SET' | 'MISSING';
  authJwtSecretLength: number;
  inheritedAuthJwtPresent: boolean;
  inheritedAuthJwtWasBlank: boolean;
  nodeEnv: string;
  port: string;
}

/** Safe startup diagnostics — reports names/status only, never values. */
export const getEnvDiagnostics = (): EnvDiagnostics => {
  const secret = process.env[AUTH_KEY] || '';
  return {
    cwd: process.cwd(),
    resolvedEnvPath,
    envExists,
    dotenvLoaded,
    dotenvError,
    authJwtSecret: secret.trim().length > 0 ? 'SET' : 'MISSING',
    authJwtSecretLength: secret.length,
    inheritedAuthJwtPresent: inheritedPresent,
    inheritedAuthJwtWasBlank: Boolean(inheritedBlank),
    nodeEnv: process.env.NODE_ENV || '(unset)',
    port: process.env.PORT || '(unset, default 4000)',
  };
};
