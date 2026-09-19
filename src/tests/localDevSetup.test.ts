/**
 * Permanent local-development setup regression tests.
 *
 * Locks in the fixed day-to-day contract:
 * - Backend  → http://localhost:4000 (PORT from backend .env, default 4000;
 *   never silently falls back to 3000).
 * - Frontend → http://localhost:3000, API base http://localhost:4000.
 * - CORS allows exactly the local origins with credentials + preflight,
 *   with the middleware running before routes.
 * - Env loads from an absolute/resolved project-root .env path.
 * - GET /health stays available for the dev:all launcher health check.
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app, { DEFAULT_BACKEND_PORT, resolveBackendPort } from '../app';
import { getEnvDiagnostics, resolveEnvPath } from '../config/env';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

describe('local development setup (permanent contract)', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  describe('backend port 4000', () => {
    it('defaults to 4000 (never 3000) when PORT is missing', () => {
      expect(DEFAULT_BACKEND_PORT).toBe(4000);
      delete process.env.PORT;
      expect(resolveBackendPort()).toBe(4000);
    });

    it('honours PORT from the backend .env environment', () => {
      process.env.PORT = '4000';
      expect(resolveBackendPort()).toBe(4000);
      process.env.PORT = '4123';
      expect(resolveBackendPort()).toBe(4123);
    });

    it('documents PORT=4000 in .env.example', () => {
      const example = fs.readFileSync(path.join(PROJECT_ROOT, '.env.example'), 'utf8');
      expect(example).toMatch(/^PORT=4000$/m);
    });
  });

  describe('CORS for local frontend origins', () => {
    it.each(['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'])(
      'echoes %s with credentials on normal responses',
      async (origin) => {
        const res = await request(app).get('/health').set('Origin', origin);
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
        expect(res.headers['access-control-allow-credentials']).toBe('true');
      }
    );

    it('does not use a wildcard and rejects unlisted origins', async () => {
      const res = await request(app).get('/health').set('Origin', 'http://evil.example');
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('answers OPTIONS preflight with Authorization and Content-Type allowed', async () => {
      const res = await request(app)
        .options('/api/v1/calls/start')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, Authorization');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-headers']).toContain('Authorization');
      expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('frontend API URL (env architecture, not hardcoded)', () => {
    it('sets VITE_API_BASE_URL=http://localhost:4000 in frontend/.env.example', () => {
      const example = fs.readFileSync(
        path.join(PROJECT_ROOT, 'frontend', '.env.example'),
        'utf8'
      );
      expect(example).toMatch(/^VITE_API_BASE_URL=http:\/\/localhost:4000$/m);
    });

    it('never places server secrets in the frontend env example', () => {
      const example = fs.readFileSync(
        path.join(PROJECT_ROOT, 'frontend', '.env.example'),
        'utf8'
      );
      expect(example).not.toMatch(/AUTH_JWT_SECRET/);
      expect(example).not.toMatch(/DATABASE_URL/);
    });
  });

  describe('environment loading', () => {
    it('resolves an absolute project-root .env path', () => {
      const resolved = resolveEnvPath();
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved.endsWith('.env')).toBe(true);
      expect(fs.existsSync(resolved)).toBe(true);
    });

    it('diagnostics report status without secret values', () => {
      const diag = getEnvDiagnostics();
      expect(path.isAbsolute(diag.resolvedEnvPath)).toBe(true);
      expect(['SET', 'MISSING']).toContain(diag.authJwtSecret);
      expect(JSON.stringify(diag)).not.toContain(process.env.AUTH_JWT_SECRET || '___no_secret_set___');
    });
  });

  describe('health endpoint', () => {
    it('GET /health returns status ok for the launcher health check', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
