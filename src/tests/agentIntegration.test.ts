import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { MockLlmProvider, getLlmProvider } from '../agent/llm';
import { orchestrator, isKnowledgeSearchRequired } from '../agent/orchestrator';

jest.mock('../database', () => {
  const mPool = {
    query: jest.fn(),
  };
  return { pool: mPool, default: mPool };
});

describe('Phase 7: AI Agent + RAG Integration', () => {
  const savedLlmProvider = process.env.LLM_PROVIDER;

  beforeAll(() => {
    // Offline deterministic provider for integration tests (mock is tests-only by policy).
    process.env.LLM_PROVIDER = 'mock';
  });

  afterAll(() => {
    if (savedLlmProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = savedLlmProvider;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. LLM Provider Abstraction & Mock Provider', () => {
    it('should load MockLlmProvider and return offline completion without API keys', async () => {
      const provider = new MockLlmProvider();
      expect(provider.getProviderName()).toBe('mock');

      const response = await provider.generateResponse([
        { role: 'user', content: 'Hello' }
      ]);
      expect(response.content).toBeDefined();
      expect(typeof response.content).toBe('string');
      expect(response.finishReason).toBe('stop');
    });

    it('should support streaming chunks in MockLlmProvider', async () => {
      const provider = new MockLlmProvider();
      const chunks: string[] = [];
      await provider.generateStream(
        [{ role: 'user', content: 'Tell me shipping options' }],
        undefined,
        (chunk) => chunks.push(chunk)
      );
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('2. Agent Orchestrator & Selective RAG Evaluation', () => {
    it('should evaluate whether factual company knowledge search is required', () => {
      expect(isKnowledgeSearchRequired('What is your delivery policy and SOP?')).toBe(true);
      expect(isKnowledgeSearchRequired('What are the shipping rates and rules?')).toBe(true);
      expect(isKnowledgeSearchRequired('Hello, good morning')).toBe(false);
      expect(isKnowledgeSearchRequired('My pickup location is Chennai')).toBe(false);
    });

    it('should process turn and return response incorporating state context when callId is provided', async () => {
      const mockState = {
        id: 'state-123',
        call_id: 'call-123',
        customer_name: 'John Doe',
        pickup_location: 'Chennai',
        destination: 'Bengaluru',
        cargo_weight: 500
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockState] });

      const response = await orchestrator.processTurn({
        callId: 'call-123',
        messages: [{ role: 'user', content: 'Where is my pickup?' }]
      });

      expect(response.content).toBeDefined();
    });
  });

  describe('3. Voice retirement (Phase 14)', () => {
    it('no longer exposes Vapi custom-LLM endpoints', async () => {
      const res = await request(app)
        .post('/api/v1/vapi/custom-llm/chat/completions')
        .send({ messages: [{ role: 'user', content: 'Hello' }] });
      expect(res.status).toBe(404);
    });

    it('no longer exposes Vapi webhook tool routes', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/vapi/tools')
        .send({ message: { type: 'tool-calls', toolCallList: [] } });
      expect(res.status).toBe(404);
    });

    it('no longer exposes outbound voice-call initiation', async () => {
      const res = await request(app)
        .post('/api/v1/calls/start')
        .send({ leadId: 'lead-1' });
      expect(res.status).toBe(404);
    });
  });
});
