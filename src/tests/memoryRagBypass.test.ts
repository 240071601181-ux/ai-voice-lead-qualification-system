/**
 * Memory questions bypass RAG; knowledge questions still retrieve.
 *
 * Proves the orchestrator routing gate (scoring/thresholds untouched):
 * - "What vehicle did I ask for?" contains the RAG keyword "vehicle" yet
 *   must NOT trigger retrieval (state + history suffice).
 * - "What vehicles do you provide?" (knowledge phrasing) still retrieves.
 */
import { pool } from '../database';
import { orchestrator } from '../agent/orchestrator';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

describe('memory/RAG routing', () => {
  const savedLlmProvider = process.env.LLM_PROVIDER;

  beforeAll(() => {
    process.env.LLM_PROVIDER = 'mock';
  });

  afterAll(() => {
    if (savedLlmProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = savedLlmProvider;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM conversation_states')) {
        return {
          rows: [
            {
              id: 's1',
              conversation_id: 'conv-1',
              customer_name: 'Santhosh',
              pickup_location: 'Chennai',
              destination: 'Bangalore',
              vehicle_type: '32ft truck',
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  const knowledge = () => require('../services/knowledgeService') as typeof import('../services/knowledgeService');

  it('skips retrieval for a memory question containing a RAG keyword', async () => {
    const spy = jest
      .spyOn(knowledge(), 'searchKnowledge')
      .mockResolvedValue({ results: [] } as any);
    const response = await orchestrator.processTurn({
      conversationId: 'conv-1',
      channel: 'web',
      messages: [{ role: 'user', content: 'What vehicle did I ask for?' }],
    });
    expect(response.content).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('still retrieves for knowledge phrasing', async () => {
    const spy = jest
      .spyOn(knowledge(), 'searchKnowledge')
      .mockResolvedValue({ results: [] } as any);
    const response = await orchestrator.processTurn({
      conversationId: 'conv-1',
      channel: 'web',
      messages: [{ role: 'user', content: 'What vehicles do you provide?' }],
    });
    expect(response.content).toBeDefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('still retrieves for Tamil knowledge questions', async () => {
    const spy = jest
      .spyOn(knowledge(), 'searchKnowledge')
      .mockResolvedValue({ results: [] } as any);
    const response = await orchestrator.processTurn({
      conversationId: 'conv-1',
      channel: 'web',
      messages: [{ role: 'user', content: 'நீங்கள் எந்த வகையான வாகனங்களை வழங்குகிறீர்கள்?' }],
    });
    expect(response.content).toBeDefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('skips retrieval for Tamil trivial greetings', async () => {
    const spy = jest
      .spyOn(knowledge(), 'searchKnowledge')
      .mockResolvedValue({ results: [] } as any);
    for (const greeting of ['வணக்கம்', 'நன்றி', 'சரி']) {
      jest.clearAllMocks();
      (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
        if (sql.includes('FROM conversation_states')) {
          return { rows: [] };
        }
        return { rows: [] };
      });
      const response = await orchestrator.processTurn({
        conversationId: 'conv-1',
        channel: 'web',
        messages: [{ role: 'user', content: greeting }],
      });
      expect(response.content).toBeDefined();
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
