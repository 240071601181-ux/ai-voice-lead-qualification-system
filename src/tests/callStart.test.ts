/**
 * PHASE 14C-VOICE-1 – POST /api/v1/calls/start tests (pool + Vapi HTTP mocked).
 *
 * Covers: invalid lead (404), missing/invalid phone (422), duplicate
 * initiation (409, provider never called), successful initiation with a
 * mocked Vapi client (201 + persisted vapi_call_id), and unconfigured
 * Vapi credentials (503, never faked as success).
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import {
  resetVapiCallHttpClientForTests,
  setVapiCallHttpClientForTests
} from '../services/vapiCallService';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

describe('POST /api/v1/calls/start', () => {
  const OLD_ENV = process.env;

  const lead: any = {
    id: 'lead-1',
    source: 'web',
    name: 'Arjun Rao',
    phone: '+91 98765 22109',
    email: null,
    status: 'NEW'
  };

  const mockCreateCall = jest.fn();

  const mockReads = (overrides?: { leadRows?: any[]; activeRows?: any[] }) => {
    const leadRows = overrides?.leadRows ?? [lead];
    const activeRows = overrides?.activeRows ?? [];
    let insertedParams: any[] | null = null;
    (pool.query as jest.Mock).mockImplementation((sql: string, params?: any[]) => {
      const s = String(sql);
      if (/FROM leads WHERE id/.test(s)) return Promise.resolve({ rows: leadRows });
      if (/FROM calls WHERE lead_id/.test(s)) return Promise.resolve({ rows: activeRows });
      if (/FROM calls WHERE vapi_call_id/.test(s)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO calls/.test(s)) {
        insertedParams = params || [];
        return Promise.resolve({
          rows: [
            {
              id: 'call-internal-1',
              vapi_call_id: (params || [])[0],
              lead_id: (params || [])[1],
              status: (params || [])[2],
              started_at: (params || [])[3]
            }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });
    return { getInserted: () => insertedParams };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...OLD_ENV,
      VAPI_API_KEY: 'test-vapi-key',
      VAPI_BASE_URL: 'https://api.vapi.ai',
      VAPI_ASSISTANT_ID: 'asst-1',
      VAPI_PHONE_NUMBER_ID: 'pn-1'
    };
    mockCreateCall.mockReset();
    mockCreateCall.mockResolvedValue({ id: 'vapi-call-123', status: 'queued' });
    setVapiCallHttpClientForTests({ createCall: mockCreateCall });
  });

  afterEach(() => {
    resetVapiCallHttpClientForTests();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('should return 400 without a leadId', async () => {
    const res = await request(app).post('/api/v1/calls/start').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockCreateCall).not.toHaveBeenCalled();
  });

  it('should return 404 for an unknown lead', async () => {
    mockReads({ leadRows: [] });
    const res = await request(app).post('/api/v1/calls/start').send({ leadId: 'missing' });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(mockCreateCall).not.toHaveBeenCalled();
  });

  it('should return 422 for a lead with an invalid phone number', async () => {
    mockReads({ leadRows: [{ ...lead, phone: 'not-a-number' }] });
    const res = await request(app).post('/api/v1/calls/start').send({ leadId: 'lead-1' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(mockCreateCall).not.toHaveBeenCalled();
  });

  it('should return 422 for a lead with a missing phone number', async () => {
    mockReads({ leadRows: [{ ...lead, phone: null }] });
    const res = await request(app).post('/api/v1/calls/start').send({ leadId: 'lead-1' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(mockCreateCall).not.toHaveBeenCalled();
  });

  it('should return 409 when a call is already in progress (duplicate initiation)', async () => {
    mockReads({
      activeRows: [{ id: 'call-active', vapi_call_id: 'vapi-old', lead_id: 'lead-1', status: 'initiated' }]
    });
    const res = await request(app).post('/api/v1/calls/start').send({ leadId: 'lead-1' });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(mockCreateCall).not.toHaveBeenCalled();
  });

  it('should initiate a real call with the mocked Vapi client and persist the Vapi call id', async () => {
    const { getInserted } = mockReads();
    const res = await request(app).post('/api/v1/calls/start').send({ leadId: 'lead-1' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      callId: 'call-internal-1',
      vapiCallId: 'vapi-call-123',
      status: 'initiated',
      leadId: 'lead-1'
    });

    // Vapi boundary called once with the documented outbound-call payload.
    expect(mockCreateCall).toHaveBeenCalledTimes(1);
    const args = mockCreateCall.mock.calls[0][0];
    expect(args.body).toMatchObject({
      assistantId: 'asst-1',
      phoneNumberId: 'pn-1',
      customer: { number: '+919876522109' }
    });

    // Existing calls lifecycle row persisted with the real Vapi call id.
    const inserted = getInserted();
    expect(inserted).not.toBeNull();
    expect(inserted?.[0]).toBe('vapi-call-123');
    expect(inserted?.[1]).toBe('lead-1');
    expect(inserted?.[2]).toBe('initiated');

    // Secret key never leaks into the API response.
    expect(JSON.stringify(res.body)).not.toContain('test-vapi-key');
  });

  it('should return 503 (never fake success) when Vapi calling is unconfigured', async () => {
    process.env = { ...process.env, VAPI_ASSISTANT_ID: '', VAPI_PHONE_NUMBER_ID: '' };
    mockReads();
    const res = await request(app).post('/api/v1/calls/start').send({ leadId: 'lead-1' });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe(
      'Voice calling is not configured. Add a supported Vapi/Twilio phone number to place outbound calls.'
    );
    expect(mockCreateCall).not.toHaveBeenCalled();
  });

  it('should report unconfigured telephony when Vapi rejects our credentials/numbers', async () => {
    mockReads();
    for (const vapiStatus of [400, 401, 403]) {
      const providerErr: any = new Error(`Request failed with status code ${vapiStatus}`);
      providerErr.status = vapiStatus;
      providerErr.response = { status: vapiStatus };
      mockCreateCall.mockRejectedValueOnce(providerErr);
      const res = await request(app).post('/api/v1/calls/start').send({ leadId: 'lead-1' });
      expect(res.status).toBe(503);
      expect(res.body.error.message).toBe(
        'Voice calling is not configured. Add a supported Vapi/Twilio phone number to place outbound calls.'
      );
    }
  });

  it('should keep provider-side failures as sanitized 502', async () => {
    mockReads();
    const providerErr: any = new Error('Request failed with status code 500');
    providerErr.status = 500;
    providerErr.response = { status: 500 };
    mockCreateCall.mockRejectedValueOnce(providerErr);
    const res = await request(app).post('/api/v1/calls/start').send({ leadId: 'lead-1' });
    expect(res.status).toBe(502);
    expect(res.body.error.message).toBe('Voice provider rejected the call request');
  });

  it('should sanitize provider-side failures as 502 (axios .status never leaks)', async () => {
    mockReads();
    const providerErr: any = new Error('Request failed with status code 500');
    providerErr.status = 500;
    providerErr.response = { status: 500 };
    mockCreateCall.mockRejectedValueOnce(providerErr);
    const res = await request(app).post('/api/v1/calls/start').send({ leadId: 'lead-1' });
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('Voice provider rejected the call request');
  });
});
