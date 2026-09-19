/**
 * CORS credential support (Start call 401 fix companion).
 *
 * The frontend now sends its platform session with API requests
 * (fetch credentials: "include"). The backend must answer credentialed
 * CORS requests: specific allowlisted origin (no wildcard) plus
 * Access-Control-Allow-Credentials, with Authorization allowed for the
 * session Bearer-mirror fallback.
 */
import request from 'supertest';
import app from '../app';

describe('CORS credential support', () => {
  it('exposes the frontend origin with credentials on normal responses', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('answers preflight for the conversation API with auth headers allowed', async () => {
    const res = await request(app)
      .options('/api/v1/conversations')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type, Authorization');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
