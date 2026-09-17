/**
 * Knowledge inventory + diagnostics API.
 *
 * Covers GET /api/v1/knowledge/documents (paginated real rows + validation),
 * GET /api/v1/knowledge/documents/:id (real detail + 404), and
 * GET /api/v1/knowledge/diagnostics (real checks, never secrets).
 * The pool is mocked — no live database required.
 */
import request from 'supertest';
import app from '../app';
import { pool } from '../database';

jest.mock('../database', () => {
  const mPool = {
    query: jest.fn()
  };
  return { pool: mPool, default: mPool };
});

const mockQuery = pool.query as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Knowledge inventory API', () => {
  it('lists real documents with pagination', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-1',
            title: 'Real tariff sheet',
            source: 'tariffs/real.pdf',
            chunkCount: 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const res = await request(app).get('/api/v1/knowledge/documents?page=1&limit=20');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.documents[0].title).toBe('Real tariff sheet');
    expect(res.body.data.documents[0].chunkCount).toBe(3);
  });

  it('rejects invalid pagination', async () => {
    const badPage = await request(app).get('/api/v1/knowledge/documents?page=0');
    expect(badPage.status).toBe(400);

    const badLimit = await request(app).get('/api/v1/knowledge/documents?limit=500');
    expect(badLimit.status).toBe(400);
  });

  it('returns a real document with its chunks', async () => {
    const doc = {
      id: 'doc-1',
      title: 'Real tariff sheet',
      source: 'tariffs/real.pdf',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [doc] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'chunk-1',
            document_id: 'doc-1',
            chunk_index: 0,
            chunk_text: 'Real stored chunk text',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]
      });

    const res = await request(app).get('/api/v1/knowledge/documents/doc-1');
    expect(res.status).toBe(200);
    expect(res.body.data.document.title).toBe('Real tariff sheet');
    expect(res.body.data.chunks[0].chunk_text).toBe('Real stored chunk text');
  });

  it('returns 404 for an unknown document', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/v1/knowledge/documents/missing');
    expect(res.status).toBe(404);
  });
});

describe('Knowledge diagnostics API', () => {
  it('runs real checks without exposing secrets', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ count: 7 }] });

    const res = await request(app).get('/api/v1/knowledge/diagnostics');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.checks.length).toBeGreaterThan(0);
    expect(res.body.data.documentCount).toBe(2);
    expect(res.body.data.chunkCount).toBe(7);
    const raw = JSON.stringify(res.body.data).toLowerCase();
    expect(raw).not.toContain('api_key');
    expect(raw).not.toContain('secret');
  });

  it('serves inventory from the alternate frontend origin with credentials', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const res = await request(app)
      .get('/api/v1/knowledge/documents')
      .set('Origin', 'http://localhost:3001');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
