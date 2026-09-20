import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { chunkText, validateChunkOptions } from '../services/chunkingService';
import { MockEmbeddingProvider, getEmbeddingDimension, getEmbeddingProvider } from '../agent/embeddings';
import { ingestDocument, searchKnowledge } from '../services/knowledgeService';
import { calculateCosineSimilarity } from '../repositories/knowledgeRepository';
import { bearerFor, useInternalAuthSecret } from './helpers/internalAuth';

jest.mock('../database', () => {
  const mPool = {
    query: jest.fn(),
  };
  return { pool: mPool, default: mPool };
});

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

describe('Phase 6: RAG & Knowledge Retrieval System', () => {
  let restoreAuth: (() => void) | null = null;
  beforeAll(() => {
    restoreAuth = useInternalAuthSecret();
  });
  afterAll(() => {
    restoreAuth?.();
  });

  const authedPost = (url: string) =>
    request(app).post(url).set('Authorization', bearerFor());

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Text Chunking Service & Validation', () => {
    it('should split text into chunks respecting word boundaries', () => {
      const text = 'The quick brown fox jumps over the lazy dog. Logistics shipping rates depend on weight and destination.';
      const chunks = chunkText(text, { chunkSize: 45, chunkOverlap: 10 });
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].index).toBe(0);
      expect(chunks[0].text).toBeDefined();
    });

    it('should reject invalid chunkSize (<= 0)', () => {
      expect(() => validateChunkOptions({ chunkSize: 0, chunkOverlap: 0 })).toThrow('chunkSize must be a positive number greater than 0');
      expect(() => validateChunkOptions({ chunkSize: -10, chunkOverlap: 0 })).toThrow('chunkSize must be a positive number greater than 0');
    });

    it('should reject chunkOverlap >= chunkSize', () => {
      expect(() => validateChunkOptions({ chunkSize: 100, chunkOverlap: 100 })).toThrow('chunkOverlap must be strictly less than chunkSize');
      expect(() => validateChunkOptions({ chunkSize: 100, chunkOverlap: 150 })).toThrow('chunkOverlap must be strictly less than chunkSize');
    });

    it('should return empty array for empty text', () => {
      const chunks = chunkText('');
      expect(chunks).toEqual([]);
    });
  });

  describe('2. Embedding Provider Abstraction & Dimension Enforcement', () => {
    it('should generate deterministic vectors matching exact requested dimension', async () => {
      const dimension = 1536;
      const provider = new MockEmbeddingProvider(dimension);
      expect(provider.getDimension()).toBe(dimension);

      const vector = await provider.getEmbedding('Shipping terms and policy');
      expect(vector).toHaveLength(dimension);

      // Verify determinism
      const vector2 = await provider.getEmbedding('Shipping terms and policy');
      expect(vector).toEqual(vector2);
    });

    it('should calculate cosine similarity correctly between unit vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0, 0];
      const vec3 = [0, 1, 0];

      expect(calculateCosineSimilarity(vec1, vec2)).toBeCloseTo(1.0);
      expect(calculateCosineSimilarity(vec1, vec3)).toBeCloseTo(0.0);
    });
  });

  describe('3. Knowledge Ingestion & Vector Search Service', () => {
    const mockDocId = '10000000-0000-0000-0000-000000000001';
    const mockChunkId = '20000000-0000-0000-0000-000000000002';

    it('should ingest a document and preserve document metadata and chunk index', async () => {
      const mockDocRow = {
        id: mockDocId,
        title: 'Logistics Standard Operating Procedure',
        source: 'sops/logistics.pdf',
        metadata: JSON.stringify({ category: 'operations' }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const mockChunkRow = {
        id: mockChunkId,
        document_id: mockDocId,
        chunk_index: 0,
        chunk_text: 'Standard delivery time for interstate cargo is 48 hours.',
        metadata: JSON.stringify({ category: 'operations' }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockDocRow] })   // createDocument
        .mockResolvedValueOnce({ rows: [mockChunkRow] }); // createChunks

      const result = await ingestDocument({
        title: 'Logistics Standard Operating Procedure',
        source: 'sops/logistics.pdf',
        content: 'Standard delivery time for interstate cargo is 48 hours.',
        metadata: { category: 'operations' }
      });

      expect(result.documentId).toBe(mockDocId);
      expect(result.totalChunks).toBe(1);
      expect(result.chunkIds).toContain(mockChunkId);
    });

    it('should support similarityThreshold and topK in searchKnowledge', async () => {
      const provider = getEmbeddingProvider();
      const mockQueryVec = await provider.getEmbedding('delivery time');

      const mockSearchRow = {
        id: mockChunkId,
        documentId: mockDocId,
        chunkIndex: 0,
        chunkText: 'Standard delivery time for interstate cargo is 48 hours.',
        title: 'Logistics Standard Operating Procedure',
        source: 'sops/logistics.pdf',
        metadata: JSON.stringify({ category: 'operations' }),
        docMetadata: JSON.stringify({ category: 'operations' }),
        similarity: 0.95
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSearchRow] });

      const searchResult = await searchKnowledge({
        query: 'delivery time',
        topK: 2,
        similarityThreshold: 0.5
      });

      expect(searchResult.query).toBe('delivery time');
      expect(searchResult.results).toHaveLength(1);
      expect(searchResult.results[0].similarity).toBeGreaterThanOrEqual(0.5);
      expect(searchResult.results[0].title).toBe('Logistics Standard Operating Procedure');
    });

    it('should return zero results when no chunk meets similarityThreshold', async () => {
      const mockSearchRow = {
        id: mockChunkId,
        documentId: mockDocId,
        chunkIndex: 0,
        chunkText: 'Unrelated topic text',
        title: 'Unrelated Document',
        source: 'test.pdf',
        metadata: '{}',
        docMetadata: '{}',
        similarity: 0.2
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSearchRow] });

      const searchResult = await searchKnowledge({
        query: 'quantum mechanics',
        similarityThreshold: 0.8
      });

      expect(searchResult.totalResults).toBe(0);
      expect(searchResult.results).toHaveLength(0);
    });

    it('should enforce document isolation when documentId filter is provided', async () => {
      const targetDocId = '99999999-9999-9999-9999-999999999999';

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await searchKnowledge({
        query: 'policy guidelines',
        documentId: targetDocId
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE kc.document_id = $2'),
        expect.arrayContaining([targetDocId])
      );
    });
  });

  describe('4. Knowledge REST API Endpoints', () => {
    it('POST /api/v1/knowledge/ingest - should accept document ingestion payload and return 201', async () => {
      const mockDocRow = {
        id: '10000000-0000-0000-0000-000000000001',
        title: 'API Terms',
        source: 'api.pdf',
        metadata: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const mockChunkRow = {
        id: '20000000-0000-0000-0000-000000000002',
        document_id: mockDocRow.id,
        chunk_index: 0,
        chunk_text: 'API terms of service text content.',
        metadata: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockDocRow] })
        .mockResolvedValueOnce({ rows: [mockChunkRow] });

      const res = await authedPost('/api/v1/knowledge/ingest')
        .send({
          title: 'API Terms',
          content: 'API terms of service text content.'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.documentId).toBe(mockDocRow.id);
    });

    it('POST /api/v1/knowledge/ingest - should reject missing title with 400', async () => {
      const res = await authedPost('/api/v1/knowledge/ingest')
        .send({ content: 'Only content without title' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Title is required');
    });

    it('POST /api/v1/knowledge/search - should perform similarity search and return 200', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const res = await authedPost('/api/v1/knowledge/search')
        .send({
          query: 'shipping rates',
          topK: 3
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.query).toBe('shipping rates');
    });

    it('POST /api/v1/knowledge/search - should reject missing query with 400', async () => {
      const res = await authedPost('/api/v1/knowledge/search')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('query is required');
    });
  });
});
