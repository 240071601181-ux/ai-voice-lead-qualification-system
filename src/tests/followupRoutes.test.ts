/**
 * Phase 13 – follow-up endpoint tests (pool + downstream mocked).
 *
 * Verifies the thin HTTP API: scheduling validation (201/200/400/403),
 * internal execute-due endpoint, execute-one, cancel, retry, and get-by-id.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { bearerFor, useInternalAuthSecret } from './helpers/internalAuth';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

jest.mock('../repositories/userRepository', () => {
  const actual = jest.requireActual('../repositories/userRepository');
  return {
    ...actual,
    findUserById: jest.fn(async () => ({id:'admin-user-1', email:'admin@example.com', password_hash:'x', name:'Test Admin', role:'ADMIN', status:'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString()})),
  };
});

jest.mock('../services/whatsapp/whatsappSender', () => ({
  sendWhatsappOnce: jest.fn().mockResolvedValue({ ok: true })
}));

jest.mock('../services/crm/crmSyncService', () => ({
  syncCrmContactOnce: jest.fn().mockResolvedValue({ ok: true })
}));

describe('Follow-up endpoints', () => {
  const OLD_ENV = process.env;

  const call: any = { id: 'call-1', lead_id: 'lead-1', vapi_call_id: 'vapi-1', status: 'ended' };
  const state: any = { id: 's-1', call_id: 'call-1', lead_id: 'lead-1', pickup_location: 'Chennai', destination: 'Bengaluru' };
  const hot: any = { id: 'q-1', call_id: 'call-1', lead_id: 'lead-1', score: 85, tier: 'HOT' };
  const lead: any = { id: 'lead-1', name: 'Acme', phone: '+911234567890', status: 'NEW' };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, FOLLOWUP_ENABLED: 'true', FOLLOWUP_MAX_RETRIES: '0' };
  });

  let restoreAuth: (() => void) | null = null;
  beforeAll(() => {
    restoreAuth = useInternalAuthSecret();
  });

  afterAll(() => {
    process.env = OLD_ENV;
    restoreAuth?.();
  });

  const authedPost = (url: string) =>
    request(app).post(url).set('Authorization', bearerFor());
  const authedGet = (url: string) =>
    request(app).get(url).set('Authorization', bearerFor());

  const mockScheduleReads = () => {
    (pool.query as jest.Mock).mockImplementation((sql: string, params?: any[]) => {
      const s = String(sql);
      if (/FROM calls/.test(s)) return Promise.resolve({ rows: [call] });
      if (/FROM conversation_state/.test(s)) return Promise.resolve({ rows: [state] });
      if (/FROM qualifications/.test(s)) return Promise.resolve({ rows: [hot] });
      if (/FROM leads/.test(s)) return Promise.resolve({ rows: [lead] });
      if (/FROM follow_ups WHERE followup_key/.test(s)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO follow_ups/.test(s)) {
        return Promise.resolve({ rows: [{ id: 'f-1', followup_key: params?.[0], status: 'pending', action: params?.[4] }] });
      }
      return Promise.resolve({ rows: [] });
    });
  };

  it('should reject scheduling without identity, action, or valid template', async () => {
    const noIdentity = await authedPost('/api/v1/followups/schedule').send({ action: 'crm_followup' });
    expect(noIdentity.status).toBe(400);
    const badAction = await authedPost('/api/v1/followups/schedule').send({ callId: 'call-1', action: 'nope' });
    expect(badAction.status).toBe(400);
    const badTemplate = await authedPost('/api/v1/followups/schedule')
      .send({ callId: 'call-1', action: 'whatsapp_followup', template: 'free_text' });
    expect(badTemplate.status).toBe(400);
  });

  it('should schedule explicitly with 201', async () => {
    mockScheduleReads();
    const res = await authedPost('/api/v1/followups/schedule')
      .send({ callId: 'call-1', action: 'crm_followup' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.followup_key).toBe('fu:crm_followup:call-1');
  });

  it('should execute due rows via the internal endpoint and read/cancel/retry by id', async () => {
    const due: any = {
      id: 'f-2',
      followup_key: 'fu:crm_followup:call-1',
      lead_id: 'lead-1',
      call_id: 'call-1',
      qualification_id: 'q-1',
      action: 'crm_followup',
      payload: {},
      status: 'pending',
      attempts: 0
    };
    (pool.query as jest.Mock).mockImplementation((sql: string) => {
      const s = String(sql);
      if (/status = 'pending', updated_at/.test(s)) return Promise.resolve({ rows: [] });
      if (/scheduled_at <=/.test(s)) return Promise.resolve({ rows: [due] });
      if (/FROM follow_ups WHERE id/.test(s)) return Promise.resolve({ rows: [due] });
      if (/status = 'processing'/.test(s)) return Promise.resolve({ rows: [{ ...due, status: 'processing', attempts: 1 }] });
      if (/status = 'completed'/.test(s)) return Promise.resolve({ rows: [{ ...due, status: 'completed' }] });
      if (/status = 'cancelled'/.test(s)) return Promise.resolve({ rows: [{ ...due, status: 'cancelled' }] });
      if (/status = 'pending', scheduled_at/.test(s)) return Promise.resolve({ rows: [{ ...due, status: 'pending' }] });
      return Promise.resolve({ rows: [] });
    });

    const executed = await authedPost('/api/v1/followups/execute-due').send({ limit: 10 });
    expect(executed.status).toBe(200);
    expect(executed.body.data).toMatchObject({ checked: 1, completed: 1 });

    const found = await authedGet('/api/v1/followups/f-2');
    expect(found.status).toBe(200);

    (pool.query as jest.Mock).mockImplementation((sql: string) => {
      if (/FROM follow_ups WHERE id/.test(String(sql))) {
        return Promise.resolve({ rows: [{ ...due, status: 'failed', attempts: 1 }] });
      }
      if (/status = 'pending', scheduled_at/.test(String(sql))) {
        return Promise.resolve({ rows: [{ ...due, status: 'pending' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const retried = await authedPost('/api/v1/followups/f-2/retry').send({});
    expect(retried.status).toBe(200);

    (pool.query as jest.Mock).mockImplementation((sql: string) => {
      if (/FROM follow_ups WHERE id/.test(String(sql))) {
        return Promise.resolve({ rows: [{ ...due, status: 'pending' }] });
      }
      if (/status = 'cancelled'/.test(String(sql))) {
        return Promise.resolve({ rows: [{ ...due, status: 'cancelled' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const cancelled = await authedPost('/api/v1/followups/f-2/cancel').send({});
    expect(cancelled.status).toBe(200);

    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    const missing = await authedGet('/api/v1/followups/does-not-exist');
    expect(missing.status).toBe(404);
  });
});
