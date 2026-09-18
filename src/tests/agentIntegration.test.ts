import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { MockLlmProvider, getLlmProvider } from '../agent/llm';
import { orchestrator, isKnowledgeSearchRequired } from '../agent/orchestrator';
import { normalizeVapiToolCalls } from '../controllers/vapiToolController';

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

  describe('3. Custom LLM OpenAI-Compatible Endpoint', () => {
    it('POST /api/v1/vapi/custom-llm/chat/completions - should return OpenAI chat completion format (non-streaming)', async () => {
      const res = await request(app)
        .post('/api/v1/vapi/custom-llm/chat/completions')
        .send({
          model: 'vapi-logistics-agent',
          messages: [{ role: 'user', content: 'I need to transport 500kg cargo from Chennai.' }]
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.object).toBe('chat.completion');
      expect(res.body.choices).toBeDefined();
      expect(res.body.choices[0].message.role).toBe('assistant');
      expect(res.body.choices[0].message.content).toBeDefined();
    });

    it('POST /api/v1/vapi/custom-llm/chat/completions - should return SSE stream when stream: true', async () => {
      const res = await request(app)
        .post('/api/v1/vapi/custom-llm/chat/completions')
        .send({
          model: 'vapi-logistics-agent',
          messages: [{ role: 'user', content: 'Hi' }],
          stream: true
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.text).toContain('data: [DONE]');
    });

    it('POST /api/v1/vapi/custom-llm/chat/completions - should return 400 for invalid payload without messages', async () => {
      const res = await request(app)
        .post('/api/v1/vapi/custom-llm/chat/completions')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('messages array is required');
    });

    it('should accept Vapi call context and OpenAI content parts', async () => {
      const res = await request(app)
        .post('/api/v1/vapi/custom-llm/chat/completions')
        .send({
          call: { id: 'vapi-call-001' },
          messages: [{
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }]
          }]
        });

      expect(res.status).toBe(200);
      expect(res.body.choices[0].message.content).toBeDefined();
    });

    it('should accept tool definitions in the OpenAI-compatible request', async () => {
      const res = await request(app)
        .post('/api/v1/vapi/custom-llm/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          tools: [{
            type: 'function',
            function: {
              name: 'updateConversationState',
              description: 'Update shipment details',
              parameters: { type: 'object', properties: {} }
            }
          }]
        });

      expect(res.status).toBe(200);
      expect(res.body.choices[0].message.role).toBe('assistant');
    });
  });

  describe('4. Vapi Tool-Calls Protocol & Payloads Normalization', () => {
    it('should normalize toolWithToolCallList variant', () => {
      const body = {
        message: {
          type: 'tool-calls',
          toolWithToolCallList: [
            {
              toolCall: {
                id: 'tc_001',
                function: {
                  name: 'updateConversationState',
                  arguments: JSON.stringify({ callId: 'c1', updates: { pickup_location: 'Chennai' } })
                }
              }
            }
          ]
        }
      };

      const normalized = normalizeVapiToolCalls(body);
      expect(normalized).toHaveLength(1);
      expect(normalized[0].toolCallId).toBe('tc_001');
      expect(normalized[0].name).toBe('updateConversationState');
      expect(normalized[0].arguments.callId).toBe('c1');
    });

    it('should normalize toolCallList variant', () => {
      const body = {
        message: {
          type: 'tool-calls',
          toolCallList: [
            {
              id: 'tc_002',
              function: {
                name: 'endCall',
                arguments: { callId: 'c2', reason: 'Customer finished' }
              }
            }
          ]
        }
      };

      const normalized = normalizeVapiToolCalls(body);
      expect(normalized).toHaveLength(1);
      expect(normalized[0].toolCallId).toBe('tc_002');
      expect(normalized[0].name).toBe('endCall');
      expect(normalized[0].arguments.callId).toBe('c2');
    });

    it('should normalize toolWithToolCallList parameter arguments', () => {
      const body = {
        message: {
          type: 'tool-calls',
          toolWithToolCallList: [{
            name: 'updateConversationState',
            toolCall: {
              id: 'tc_parameters',
              function: {
                name: 'updateConversationState',
                parameters: { callId: 'c3', updates: { destination: 'Bengaluru' } }
              }
            }
          }]
        }
      };

      const normalized = normalizeVapiToolCalls(body);
      expect(normalized).toHaveLength(1);
      expect(normalized[0].arguments.callId).toBe('c3');
      expect(normalized[0].arguments.updates.destination).toBe('Bengaluru');
    });

    it('should normalize tool calls with nested Vapi call context', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'internal-call-1', vapi_call_id: 'vapi-call-001' }]
      });
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'state-1' }] });

      const res = await request(app)
        .post('/api/v1/webhooks/vapi/tools')
        .send({
          message: {
            type: 'tool-calls',
            call: { id: 'vapi-call-001' },
            toolCallList: [{
              id: 'tc_context_1',
              function: {
                name: 'updateConversationState',
                arguments: { updates: { pickup_location: 'Chennai' } }
              }
            }]
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.results[0].result).toContain('updated successfully');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE conversation_state SET'),
        expect.arrayContaining(['internal-call-1'])
      );
    });

    it('POST /api/v1/webhooks/vapi/tools - should execute updateConversationState tool call and return results', async () => {
      const mockState = {
        id: 'state-1',
        call_id: 'call-1',
        pickup_location: 'Chennai',
        destination: 'Bengaluru'
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockState] });

      const res = await request(app)
        .post('/api/v1/webhooks/vapi/tools')
        .send({
          message: {
            type: 'tool-calls',
            toolCallList: [
              {
                id: 'tc_test_1',
                function: {
                  name: 'updateConversationState',
                  arguments: { callId: 'call-1', updates: { pickup_location: 'Chennai', destination: 'Bengaluru' } }
                }
              }
            ]
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].toolCallId).toBe('tc_test_1');
      expect(res.body.results[0].result).toContain('updated successfully');
    });

    it('should support the documented custom-tool endpoint alias', async () => {
      const res = await request(app)
        .post('/api/v1/vapi/custom-llm/chat/completions/custom-tool')
        .send({
          message: {
            type: 'tool-calls',
            toolCallList: [{
              id: 'tc_alias',
              function: {
                name: 'unknownTool',
                arguments: {}
              }
            }]
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.results[0].toolCallId).toBe('tc_alias');
      expect(res.body.results[0].result).toContain('Unknown tool name');
    });

    it('POST /api/v1/webhooks/vapi/tools - should execute endCall tool and update internal call status', async () => {
      // findCallByVapiId (first query)
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'call-ended-1', vapi_call_id: 'call-ended-1', status: 'initiated', started_at: new Date().toISOString() }]
      });
      // upsertCall performs its own existing-call lookup after handleEnded reads it.
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'call-ended-1', vapi_call_id: 'call-ended-1', status: 'initiated' }]
      });
      // upsertCall (second query)
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'call-ended-1', vapi_call_id: 'call-ended-1', status: 'ended' }]
      });

      const res = await request(app)
        .post('/api/v1/webhooks/vapi/tools')
        .send({
          message: {
            type: 'tool-calls',
            toolWithToolCallList: [
              {
                toolCall: {
                  id: 'tc_end_1',
                  function: {
                    name: 'endCall',
                    arguments: { callId: 'call-ended-1', reason: 'Completed requirement collection' }
                  }
                }
              }
            ]
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].toolCallId).toBe('tc_end_1');
      expect(res.body.results[0].result).toContain('Call ended');
    });
  });
});
