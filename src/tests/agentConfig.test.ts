/**
 * Agent configuration API (AI Agent page persistence).
 *
 * Covers GET/PATCH /api/v1/agent/config, POST /pause + /resume, and
 * GET /api/v1/agent/health: safe defaults, validation, pause persistence,
 * no secrets exposed, no fake metrics, and CORS from both dev origins.
 */
import request from 'supertest';
import app from '../app';
import { resetAgentConfigForTests } from '../services/agentConfigService';
import { bearerFor, useInternalAuthSecret } from './helpers/internalAuth';

jest.mock('../repositories/userRepository', () => {
  const actual = jest.requireActual('../repositories/userRepository');
  return {
    ...actual,
    findUserById: jest.fn(async () => ({
      id: 'admin-user-1',
      email: 'admin@example.com',
      password_hash: 'x',
      name: 'Test Admin',
      role: 'ADMIN',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
  };
});

let restoreAuth: (() => void) | null = null;
beforeAll(() => {
  restoreAuth = useInternalAuthSecret();
});
afterAll(() => {
  restoreAuth?.();
});

const authedGet = (url: string) =>
  request(app).get(url).set('Authorization', bearerFor());
const authedPost = (url: string) =>
  request(app).post(url).set('Authorization', bearerFor());
const authedPatch = (url: string) =>
  request(app).patch(url).set('Authorization', bearerFor());

beforeEach(() => {
  resetAgentConfigForTests();
});

describe('Agent configuration API', () => {
  it('returns safe defaults with no secrets', async () => {
    const res = await authedGet('/api/v1/agent/config');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.paused).toBe(false);
    expect(res.body.data.greeting).toEqual(expect.any(String));
    expect(res.body.data.qualificationQuestions.length).toBeGreaterThan(0);
    expect(res.body.data.escalationBehavior).toEqual(expect.any(String));
    expect(res.body.data.callEnding).toEqual(expect.any(String));
    expect(res.body.data.languages).toEqual(expect.arrayContaining(['en', 'hi', 'ta']));
    const raw = JSON.stringify(res.body.data).toLowerCase();
    expect(raw).not.toContain('vapi_api_key');
    expect(raw).not.toContain('api_key');
  });

  it('persists an edited greeting (PATCH round-trip)', async () => {
    const updated = 'Edited greeting for the persistence check.';
    const patch = await authedPatch('/api/v1/agent/config')
      .send({ greeting: updated });
    expect(patch.status).toBe(200);
    expect(patch.body.data.greeting).toBe(updated);

    const reread = await authedGet('/api/v1/agent/config');
    expect(reread.body.data.greeting).toBe(updated);
  });

  it('persists edited qualification questions', async () => {
    const questions = ['Edited question one?', 'Edited question two?'];
    const patch = await authedPatch('/api/v1/agent/config')
      .send({ qualificationQuestions: questions });
    expect(patch.status).toBe(200);
    expect(patch.body.data.qualificationQuestions).toEqual(questions);
  });

  it('rejects unknown fields and empty patches', async () => {
    const unknown = await authedPatch('/api/v1/agent/config')
      .send({ voiceCloneId: 'abc' });
    expect(unknown.status).toBe(400);

    const empty = await authedPatch('/api/v1/agent/config').send({});
    expect(empty.status).toBe(400);

    const badQuestions = await authedPatch('/api/v1/agent/config')
      .send({ qualificationQuestions: [] });
    expect(badQuestions.status).toBe(400);
  });

  it('pauses and resumes the agent with persistence', async () => {
    const paused = await authedPost('/api/v1/agent/pause');
    expect(paused.status).toBe(200);
    expect(paused.body.data.paused).toBe(true);

    const reread = await authedGet('/api/v1/agent/config');
    expect(reread.body.data.paused).toBe(true);

    const resumed = await authedPost('/api/v1/agent/resume');
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.paused).toBe(false);
  });

  it('reports honest health with no fake metrics', async () => {
    const res = await authedGet('/api/v1/agent/health');
    expect(res.status).toBe(200);
    expect(res.body.data.metrics).toBeNull();
    expect(res.body.data.metricsReason).toEqual(expect.any(String));
    expect(res.body.data.liveSession).toBe(false);
    // Phase 14: telephonyConfigured retired with Vapi — voice is no longer
    // part of the agent health contract.
    expect(res.body.data.telephonyConfigured).toBeUndefined();
    const raw = JSON.stringify(res.body.data);
    expect(raw).not.toContain('93.2');
    expect(raw).not.toContain('72.4');
  });

  it('serves the agent API from the alternate frontend origin with credentials', async () => {
    const res = await authedGet('/api/v1/agent/config')
      .set('Origin', 'http://localhost:3001');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
