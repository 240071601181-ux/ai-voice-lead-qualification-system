/**
 * Integration diagnostics APIs (Run diagnostics fix).
 *
 * Covers GET /api/v1/crm/diagnostics, POST /api/v1/crm/sync,
 * GET /api/v1/crm/syncs, GET /api/v1/whatsapp/diagnostics,
 * GET /api/v1/whatsapp/deliveries, GET /api/v1/n8n/diagnostics,
 * GET /api/v1/n8n/workflows, and GET /api/v1/calendar/bookings:
 * real checks, validation, safe messages, no secrets, CORS from 3001.
 * The pool is mocked — no live database required.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { bearerFor, useInternalAuthSecret } from './helpers/internalAuth';

jest.mock('../database', () => {
  const mPool = {
    query: jest.fn()
  };
  return { pool: mPool, default: mPool };
});

jest.mock('../repositories/userRepository', () => {
  const actual = jest.requireActual('../repositories/userRepository');
  return {
    ...actual,
    findUserById: jest.fn(async () => ({id:'admin-user-1', email:'admin@example.com', password_hash:'x', name:'Test Admin', role:'ADMIN', status:'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString()})),
  };
});

/**
 * Asserts no secret material leaks. UPPER_SNAKE_CASE env var NAMES
 * (e.g. WHATSAPP_AUTH_TOKEN) and guidance words like "secret is present"
 * are allowed — they tell the operator what to configure. Assignment forms
 * (secret=..., token=...), bearer tokens, and URLs are leaks.
 */
const assertNoSecrets = (data: unknown) => {
  const raw = JSON.stringify(data);
  const withoutEnvNames = raw.replace(/[A-Z][A-Z0-9_]{2,}/g, '');
  const lowered = withoutEnvNames.toLowerCase();
  for (const token of ['api_key=', 'auth_token=', 'secret=', 'secret:', 'bearer ', 'token=', 'https://', 'http://']) {
    expect(lowered).not.toContain(token);
  }
};

beforeEach(() => {
  jest.clearAllMocks();
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

const mockQuery = pool.query as jest.Mock;

const selectable = { rows: [{ '?column?': 1 }] };

describe('CRM integration API', () => {
  it('returns real diagnostics without secrets', async () => {
    mockQuery
      .mockResolvedValueOnce(selectable)
      .mockResolvedValueOnce(selectable)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await authedGet('/api/v1/crm/diagnostics');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const names = res.body.data.checks.map((c: any) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['enabled', 'provider', 'database', 'history', 'connectivity'])
    );
    expect(res.body.data.provider).toEqual(expect.any(String));
    assertNoSecrets(res.body.data);
  });

  it('rejects a sync with no lead or call id', async () => {
    const res = await authedPost('/api/v1/crm/sync').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/leadId or callId/);
  });

  it('truthfully reports disabled sync (503, no fake success)', async () => {
    const res = await authedPost('/api/v1/crm/sync').send({ leadId: 'lead-123' });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('validates sync history limit', async () => {
    const res = await authedGet('/api/v1/crm/syncs?limit=500');
    expect(res.status).toBe(400);
  });
});

describe('WhatsApp integration API', () => {
  it('returns real diagnostics without secrets', async () => {
    mockQuery
      .mockResolvedValueOnce(selectable)
      .mockResolvedValueOnce(selectable)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await authedGet('/api/v1/whatsapp/diagnostics');
    expect(res.status).toBe(200);
    const names = res.body.data.checks.map((c: any) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['enabled', 'provider', 'templates', 'consent', 'database', 'history', 'connectivity'])
    );
    expect(typeof res.body.data.requireConsent).toBe('boolean');
    assertNoSecrets(res.body.data);
  });

  it('validates delivery history limit', async () => {
    const res = await authedGet('/api/v1/whatsapp/deliveries?limit=0');
    expect(res.status).toBe(400);
  });
});

describe('n8n integration API', () => {
  it('returns real diagnostics without secrets or URLs', async () => {
    mockQuery
      .mockResolvedValueOnce(selectable)
      .mockResolvedValueOnce(selectable)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await authedGet('/api/v1/n8n/diagnostics');
    expect(res.status).toBe(200);
    const names = res.body.data.checks.map((c: any) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['enabled', 'secret', 'workflows', 'database', 'history', 'connectivity'])
    );
    assertNoSecrets(res.body.data);
  });

  it('lists only configured workflows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const res = await authedGet('/api/v1/n8n/workflows');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const w of res.body.data) {
      expect(w).not.toHaveProperty('url');
    }
  });
});

describe('Calendar bookings inventory API', () => {
  it('lists real bookings with pagination', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'booking-1',
            lead_id: 'lead-1',
            call_id: null,
            provider: 'google',
            external_event_id: null,
            meet_url: null,
            scheduled_start: new Date().toISOString(),
            scheduled_end: new Date().toISOString(),
            timezone: 'Asia/Kolkata',
            status: 'booked',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const res = await authedGet('/api/v1/calendar/bookings?page=1&limit=20');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.bookings[0].id).toBe('booking-1');
  });

  it('rejects invalid pagination', async () => {
    const res = await authedGet('/api/v1/calendar/bookings?page=-1');
    expect(res.status).toBe(400);
  });

  it('serves diagnostics from the alternate frontend origin with credentials', async () => {
    mockQuery
      .mockResolvedValueOnce(selectable)
      .mockResolvedValueOnce(selectable)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await authedGet('/api/v1/crm/diagnostics')
      .set('Origin', 'http://localhost:3001');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
