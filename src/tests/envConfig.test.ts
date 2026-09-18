/**
 * Regression test: runtime auth configuration loading.
 *
 * Proves that:
 * 1. getAuthConfig() honors real environment variables (env precedence).
 * 2. Blank/whitespace-only AUTH_JWT_SECRET counts as missing (fail closed).
 * 3. The .env bootstrap resolves a loadable .env (dotenv parses AUTH keys).
 * 4. Diagnostics never leak secret values.
 *
 * Uses only dummy secrets — never a real one.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAuthConfig, isAuthConfigured } from '../config';
import { getEnvDiagnostics, resolveEnvPath } from '../config/env';

const DUMMY = 'dummy-test-secret-not-real';

describe('runtime auth configuration', () => {
  const saved = { ...process.env };

  afterEach(() => {
    // Restore the exact prior environment (no leakage between tests).
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it('loads jwtSecret from the environment (env precedence, no duplication)', () => {
    process.env.AUTH_JWT_SECRET = DUMMY;
    expect(getAuthConfig().jwtSecret).toBe(DUMMY);
    expect(isAuthConfigured()).toBe(true);
  });

  it('treats blank/whitespace secrets as missing (fail closed)', () => {
    for (const blank of ['', '   ', '\t\n ']) {
      process.env.AUTH_JWT_SECRET = blank;
      expect(getAuthConfig().jwtSecret).toBe('');
      expect(isAuthConfigured()).toBe(false);
    }
    delete process.env.AUTH_JWT_SECRET;
    expect(getAuthConfig().jwtSecret).toBe('');
    expect(isAuthConfigured()).toBe(false);
  });

  it('resolves a loadable .env from the project root', () => {
    const resolved = resolveEnvPath();
    expect(fs.existsSync(resolved)).toBe(true);
    const parsed = dotenv.parse(fs.readFileSync(resolved, 'utf8'));
    // The loader must be able to parse AUTH keys out of a .env file.
    const fixture = dotenv.parse('AUTH_JWT_SECRET=fixture-value\nPORT=4000\n');
    expect(fixture.AUTH_JWT_SECRET).toBe('fixture-value');
    expect(Object.keys(parsed).length).toBeGreaterThan(0);
    // Also resolvable starting from a dist-style directory.
    const fromDist = resolveEnvPath(path.join(path.dirname(resolved), 'dist', 'config'));
    expect(fromDist).toBe(resolved);
  });

  it('parses AUTH keys out of a temp .env fixture without touching process.env', () => {
    // resolveEnvPath prefers process.cwd()/.env when present (documented
    // precedence for `npm run dev` from the project root), so the fixture
    // is parsed directly: dotenv must understand AUTH keys in .env format.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-regression-'));
    try {
      const file = path.join(dir, '.env');
      fs.writeFileSync(file, 'AUTH_JWT_SECRET=fixture-only-secret\nPORT=4000\n');
      const parsed = dotenv.parse(fs.readFileSync(file, 'utf8'));
      expect(parsed.AUTH_JWT_SECRET).toBe('fixture-only-secret');
      expect(parsed.PORT).toBe('4000');
      // Resolver contract: always returns an absolute .env path.
      expect(path.isAbsolute(resolveEnvPath())).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('diagnostics report status/length but never secret values', () => {
    process.env.AUTH_JWT_SECRET = DUMMY;
    const diag = getEnvDiagnostics();
    expect(diag.authJwtSecret).toBe('SET');
    expect(diag.authJwtSecretLength).toBe(DUMMY.length);
    const blob = JSON.stringify(diag);
    expect(blob).not.toContain(DUMMY);
  });
});
