import request from 'supertest';
import app from '../app';
import { pool } from '../database';
import { signChatToken } from '../middleware/conversationAuth';
import { resetChatRateLimitsForTests } from '../middleware/chatRateLimit';
import { orchestrator } from '../agent/orchestrator';

jest.mock('../database', () => {
  const mPool = {
    query: jest.fn(),
  };
  return { pool: mPool, default: mPool };
});

const TEST_SECRET = 'phase3-test-secret-do-not-use-in-prod';

let convo: any;
let messages: any[];
let msgSeq: number;
let leadRow: any | null;

const resetStore = () => {
  convo = {
    id: 'conv-1',
    lead_id: 'lead-1',
    channel: 'web',
    status: 'active',
    started_at: new Date().toISOString(),
    ended_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  messages = [];
  msgSeq = 0;
  leadRow = { id: 'lead-1', name: 'Test Lead', phone: '+911234567890', status: 'NEW' };
};

const installPoolMock = () => {
  (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
    if (sql.includes('INSERT INTO conversations')) {
      convo = {
        id: 'conv-1',
        lead_id: params[0],
        channel: params[1],
        status: params[2],
        started_at: new Date().toISOString(),
        ended_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return { rows: [convo] };
    }
    if (sql.includes('UPDATE conversations')) {
      if (!convo) return { rows: [] };
      convo = { ...convo, status: params[0], ended_at: convo.ended_at || new Date().toISOString() };
      return { rows: [convo] };
    }
    if (sql.includes('SELECT COUNT(*) AS total FROM conversations')) {
      return { rows: [{ total: convo ? '1' : '0' }] };
    }
    if (sql.includes('SELECT * FROM conversations WHERE id')) {
      return { rows: convo ? [convo] : [] };
    }
    if (sql.includes('SELECT * FROM conversations')) {
      return { rows: convo ? [convo] : [] };
    }
    if (sql.includes('INSERT INTO conversation_messages')) {
      const row = {
        id: `msg-${++msgSeq}`,
        conversation_id: params[0],
        role: params[1],
        content: params[2],
        metadata: params[3],
        tool_calls: params[4],
        created_at: new Date().toISOString(),
      };
      messages.push(row);
      return { rows: [row] };
    }
    if (sql.includes('SELECT COUNT(*) AS total FROM conversation_messages')) {
      return { rows: [{ total: String(messages.length) }] };
    }
    if (sql.includes('FROM conversation_messages')) {
      return { rows: [...messages] };
    }
    if (sql.includes('FROM conversation_states')) {
      return { rows: [] };
    }
    if (sql.includes('FROM leads WHERE id')) {
      return { rows: leadRow ? [leadRow] : [] };
    }
    return { rows: [] };
  });
};

describe('Phase 3: Text Conversation API', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of [
      'CHAT_JWT_SECRET',
      'CHAT_RATE_LIMIT_WINDOW_MS',
      'CHAT_RATE_LIMIT_MAX',
      'CHAT_MESSAGE_RATE_LIMIT_MAX',
      'CHAT_MAX_MESSAGE_LENGTH',
      'CHAT_ALLOW_LEGACY_VOICE',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.CHAT_JWT_SECRET = TEST_SECRET;
    process.env.CHAT_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MESSAGE_RATE_LIMIT_MAX = '1000';
    process.env.CHAT_MAX_MESSAGE_LENGTH = '4000';
    delete process.env.CHAT_ALLOW_LEGACY_VOICE;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
    installPoolMock();
    resetChatRateLimitsForTests();
  });

  const auth = (sub = 'tester') => `Bearer ${signChatToken(sub)}`;

  describe('authentication', () => {
    it('should reject missing tokens with 401', async () => {
      const res = await request(app).post('/api/v1/conversations').send({ channel: 'web' });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid tokens with 401', async () => {
      const res = await request(app)
        .get('/api/v1/conversations/conv-1/messages')
        .set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });

    it('should reject tokens signed with the wrong secret', async () => {
      const res = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${signChatToken('tester', 3600, 'wrong-secret')}`);
      expect(res.status).toBe(401);
    });

    it('should allow valid tokens', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', auth())
        .send({ channel: 'web' });
      expect(res.status).toBe(201);
      expect(res.body.data.channel).toBe('web');
    });
  });

  describe('rate limiting', () => {
    it('should return 429 once the message limit is exceeded', async () => {
      process.env.CHAT_MESSAGE_RATE_LIMIT_MAX = '2';
      resetChatRateLimitsForTests();

      const first = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'Hello one' });
      const second = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'Hello two' });
      const third = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'Hello three' });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe(429);

      process.env.CHAT_MESSAGE_RATE_LIMIT_MAX = '1000';
    });
  });

  describe('conversation lifecycle', () => {
    it('should create a web/active conversation by default', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', auth())
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.data.channel).toBe('web');
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.id).toBeDefined();
    });

    it('should create whatsapp conversations and link valid leads', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', auth())
        .send({ channel: 'whatsapp', leadId: 'lead-1' });
      expect(res.status).toBe(201);
      expect(res.body.data.channel).toBe('whatsapp');
      expect(res.body.data.lead_id).toBe('lead-1');
    });

    it('should reject unknown channels and legacy_voice through the text API', async () => {
      const bad = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', auth())
        .send({ channel: 'voice' });
      expect(bad.status).toBe(400);

      const legacy = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', auth())
        .send({ channel: 'legacy_voice' });
      expect(legacy.status).toBe(400);
    });

    it('should reject missing or unknown leadIds', async () => {
      const empty = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', auth())
        .send({ leadId: '' });
      expect(empty.status).toBe(400);

      leadRow = null;
      const unknown = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', auth())
        .send({ leadId: 'lead-missing' });
      expect(unknown.status).toBe(400);
    });

    it('should list conversations with deterministic pagination', async () => {
      const res = await request(app)
        .get('/api/v1/conversations?page=1&limit=10')
        .set('Authorization', auth());
      expect(res.status).toBe(200);
      expect(res.body.data.conversations).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.limit).toBe(10);

      const badFilter = await request(app)
        .get('/api/v1/conversations?status=ended')
        .set('Authorization', auth());
      expect(badFilter.status).toBe(400);
    });

    it('should return conversation with lead summary and message count, not history', async () => {
      messages.push({ id: 'msg-0', role: 'user', content: 'Earlier' });
      const res = await request(app)
        .get('/api/v1/conversations/conv-1')
        .set('Authorization', auth());
      expect(res.status).toBe(200);
      expect(res.body.data.conversation.id).toBe('conv-1');
      expect(res.body.data.lead).toMatchObject({ id: 'lead-1', name: 'Test Lead' });
      expect(res.body.data.messageCount).toBe(1);
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.messages).toBeUndefined();
    });

    it('should return 404 for unknown conversations', async () => {
      convo = null;
      const res = await request(app)
        .get('/api/v1/conversations/conv-missing')
        .set('Authorization', auth());
      expect(res.status).toBe(404);
    });

    it('should complete and abandon conversations and block late messages', async () => {
      const done = await request(app)
        .post('/api/v1/conversations/conv-1/complete')
        .set('Authorization', auth());
      expect(done.status).toBe(200);
      expect(done.body.data.status).toBe('completed');
      expect(done.body.data.ended_at).toBeTruthy();

      const late = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'Too late' });
      expect(late.status).toBe(409);

      resetStore();
      installPoolMock();
      const dropped = await request(app)
        .post('/api/v1/conversations/conv-1/abandon')
        .set('Authorization', auth());
      expect(dropped.status).toBe(200);
      expect(dropped.body.data.status).toBe('abandoned');
    });

    it('should treat repeat completion as idempotent', async () => {
      convo.status = 'completed';
      const res = await request(app)
        .post('/api/v1/conversations/conv-1/complete')
        .set('Authorization', auth());
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
    });
  });

  describe('message flow', () => {
    it('should persist user and assistant messages in order', async () => {
      const res = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: '  Hello, I need to ship cargo  ' });
      expect(res.status).toBe(201);
      expect(res.body.data.userMessage.role).toBe('user');
      expect(res.body.data.userMessage.content).toBe('Hello, I need to ship cargo');
      expect(res.body.data.assistantMessage.role).toBe('assistant');
      expect(res.body.data.assistantMessage.content?.length).toBeGreaterThan(0);
      expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    });

    it('should serve chronological history pages', async () => {
      await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'First question' });
      const history = await request(app)
        .get('/api/v1/conversations/conv-1/messages?page=1&limit=10')
        .set('Authorization', auth());
      expect(history.status).toBe(200);
      expect(history.body.data.total).toBe(2);
      expect(history.body.data.messages[0].role).toBe('user');
      expect(history.body.data.messages[1].role).toBe('assistant');
    });

    it('should reject empty and oversized content', async () => {
      const empty = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: '   ' });
      expect(empty.status).toBe(400);

      const big = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'x'.repeat(4001) });
      expect(big.status).toBe(400);
    });

    it('should return 404 for messages on unknown conversations', async () => {
      convo = null;
      const res = await request(app)
        .post('/api/v1/conversations/conv-missing/messages')
        .set('Authorization', auth())
        .send({ content: 'Hi' });
      expect(res.status).toBe(404);
    });
  });

  describe('agent integration', () => {
    it('should invoke the orchestrator with conversation identity and context', async () => {
      const spy = jest.spyOn(orchestrator, 'processTurn');
      try {
        const res = await request(app)
          .post('/api/v1/conversations/conv-1/messages')
          .set('Authorization', auth())
          .send({ content: 'I need a truck from Chennai' });
        expect(res.status).toBe(201);
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            conversationId: 'conv-1',
            channel: 'web',
            context: expect.objectContaining({
              conversationId: 'conv-1',
              leadId: 'lead-1',
              channel: 'web',
            }),
          })
        );
        // State + history come from the text tables, not the legacy call path.
        expect(pool.query).toHaveBeenCalledWith(
          'SELECT * FROM conversation_states WHERE conversation_id = $1',
          ['conv-1']
        );
        expect(pool.query).not.toHaveBeenCalledWith(
          expect.stringContaining('WHERE call_id'),
          expect.anything()
        );
      } finally {
        spy.mockRestore();
      }
    });

    it('should keep the RAG path working for policy questions', async () => {
      const res = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'What is your delivery policy?' });
      expect(res.status).toBe(201);
      expect(res.body.data.assistantMessage.content?.length).toBeGreaterThan(0);
    });
  });

  describe('security', () => {
    it('should never leak prompts, secrets, or tokens in responses', async () => {
      const res = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'Hello' });
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('CHAT_JWT_SECRET');
      expect(body).not.toContain(TEST_SECRET);
      expect(body).not.toContain('systemPrompt');
      expect(body).not.toContain('OPERATOR CONFIGURATION');
    });

    it('should reject unauthenticated history access (no ownership model yet)', async () => {
      const res = await request(app).get('/api/v1/conversations/conv-1');
      expect(res.status).toBe(401);
    });

    it('should return a safe 500 without stack traces on unexpected failure', async () => {
      (pool.query as jest.Mock).mockImplementationOnce(() => {
        throw new Error('simulated db outage');
      });
      const res = await request(app)
        .post('/api/v1/conversations/conv-1/messages')
        .set('Authorization', auth())
        .send({ content: 'Hello' });
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain('at ');
    });
  });
});
