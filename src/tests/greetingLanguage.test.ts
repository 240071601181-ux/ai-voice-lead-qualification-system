/**
 * Natural greeting + language matching (Phase: greeting bug-fix).
 *
 * - Language is detected from the customer's script (Tamil present or not),
 *   never from locale: English in → English out, Tamil in → Tamil out,
 *   mixed in → mixed out.
 * - A bare hello is answered deterministically in the matched language with
 *   the trusted name when known: no LLM turn (so no language drift and no
 *   invented company boilerplate), no RAG, exactly one natural line.
 * - Every other turn carries an explicit per-turn language directive, and
 *   company identity may only come from retrieved knowledge.
 */
import {
  buildGreetingReply,
  detectTurnLanguage,
  isGreetingOnly,
  languageDirective,
} from '../agent/memoryAnswers';
import { isKnowledgeSearchRequired, TEXT_TURN_GUIDANCE } from '../agent/orchestrator';
import { agentConfig } from '../agent/config';
import { orchestrator } from '../agent/orchestrator';
import { pool } from '../database';

jest.mock('../database', () => {
  const mPool = { query: jest.fn() };
  return { pool: mPool, default: mPool };
});

describe('turn language detection (customer script only)', () => {
  it('detects English, Tamil, and mixed turns', () => {
    expect(detectTurnLanguage('hi')).toBe('english');
    expect(detectTurnLanguage('Hi')).toBe('english');
    expect(detectTurnLanguage('Hello, I need a truck.')).toBe('english');
    expect(detectTurnLanguage('வணக்கம்')).toBe('tamil');
    expect(detectTurnLanguage('எனக்கு ஒரு truck வேண்டும்')).toBe('mixed');
    expect(detectTurnLanguage('Pickup Chennai, destination Bangalore. Budget 20000 ரூபாய்.')).toBe(
      'mixed'
    );
    expect(detectTurnLanguage('Hi, எனக்கு Chennai லிருந்து Bangaloreக்கு truck வேண்டும்.')).toBe(
      'mixed'
    );
  });

  it('emits an explicit directive per language', () => {
    expect(languageDirective('english')).toMatch(/English only/);
    expect(languageDirective('tamil')).toMatch(/Tamil only/);
    expect(languageDirective('mixed')).toMatch(/same Tamil-English mix/);
  });
});

describe('greeting-only detection', () => {
  it('matches bare hellos across cases and punctuation', () => {
    for (const greeting of ['hi', 'Hi', 'HI!', 'Hello', 'hello!', 'hey', 'hiii', 'வணக்கம்', 'வணக்கம்!']) {
      expect(isGreetingOnly(greeting)).toBe(true);
    }
    expect(isGreetingOnly('good morning')).toBe(true);
  });

  it('rejects anything carrying content', () => {
    for (const text of [
      'Hi, I need a truck.',
      'Hello, I need a truck.',
      'hi hello', // two greetings is a (odd) statement, not a bare hello
      'What is my pickup?',
      'Thanks',
      'My name is Santhosh.',
      'Pickup Chennai.',
      '',
      'வணக்கம், எனக்கு truck வேண்டும்',
    ]) {
      expect(isGreetingOnly(text)).toBe(false);
    }
  });
});

describe('deterministic greeting replies', () => {
  it('greets in English without inventing names or companies', () => {
    expect(buildGreetingReply('hi', null)).toBe('Hi! How can I help with your shipment today?');
    expect(buildGreetingReply('Hi', null)).not.toMatch(/John|company|welcome/i);
  });

  it('uses a trusted name naturally when one is known', () => {
    expect(buildGreetingReply('hi', 'Santhosh Punnaivanam')).toBe(
      'Hello Santhosh Punnaivanam! How can I help with your shipment today?'
    );
  });

  it('greets in Tamil with no placeholders or company boilerplate', () => {
    expect(buildGreetingReply('வணக்கம்', null)).toBe(
      'வணக்கம்! உங்கள் shipment-க்கு எப்படி உதவலாம்?'
    );
    const named = buildGreetingReply('வணக்கம்', 'சந்தோஷ்');
    expect(named).toContain('சந்தோஷ்');
    expect(named).not.toMatch(/John|company|sample|demo/i);
  });
});

describe('greetings never trigger RAG; company questions do', () => {
  it('skips retrieval for bare greetings in either language', () => {
    expect(isKnowledgeSearchRequired('hi')).toBe(false);
    expect(isKnowledgeSearchRequired('hello')).toBe(false);
    expect(isKnowledgeSearchRequired('வணக்கம்')).toBe(false);
  });

  it('retrieves for company/service questions in either language', () => {
    expect(isKnowledgeSearchRequired('What vehicles do you provide?')).toBe(true);
    expect(isKnowledgeSearchRequired('Do you operate on Sundays?')).toBe(true);
    expect(isKnowledgeSearchRequired('நீங்கள் ஞாயிற்றுக்கிழமைகளில் சேவை வழங்குகிறீர்களா?')).toBe(true);
  });
});

describe('prompt rules (no scoring/logic change)', () => {
  it('grounds company identity in retrieved knowledge only', () => {
    expect(TEXT_TURN_GUIDANCE).toMatch(/ONLY from RETRIEVED KNOWLEDGE BASE CONTEXT/i);
    expect(TEXT_TURN_GUIDANCE).toMatch(/never invent company/i);
  });

  it('keeps collecting one or two missing fields at a time', () => {
    expect(TEXT_TURN_GUIDANCE).toMatch(/one or two questions at a time/i);
    expect(TEXT_TURN_GUIDANCE).toMatch(/never re-ask/i);
  });

  it('never invents the customer name at the core-prompt level', () => {
    expect(agentConfig.systemPrompt).toMatch(/Do not invent customer information/);
  });
});

describe('per-turn language directive in the assembled prompt', () => {
  const savedProvider = process.env.LLM_PROVIDER;
  let capturedSystem = '';

  beforeAll(() => {
    process.env.LLM_PROVIDER = 'mock';
  });
  afterAll(() => {
    if (savedProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = savedProvider;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    capturedSystem = '';
    (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM conversation_states')) return { rows: [] };
      if (sql.includes('FROM leads WHERE')) return { rows: [] };
      return { rows: [] };
    });
    const llmModule = require('../agent/llm') as typeof import('../agent/llm');
    jest.spyOn(llmModule, 'getLlmProvider').mockReturnValue({
      getProviderName: () => 'capturing-language-test',
      generateResponse: async (messages: Array<{ role: string; content: string }>) => {
        capturedSystem = messages.find((m) => m.role === 'system')?.content ?? '';
        return { content: 'Noted.', finishReason: 'stop' };
      },
    } as any);
  });

  it.each([
    ['Hello, I need a truck.', 'LANGUAGE: The customer wrote in English. Respond in English only.'],
    ['வணக்கம்', 'LANGUAGE: The customer wrote in Tamil. Respond in Tamil only (Tamil script).'],
    [
      'Pickup Chennai, destination Bangalore. Budget 20000 ரூபாய்.',
      'LANGUAGE: The customer mixed Tamil and English. Respond naturally with the same Tamil-English mix.',
    ],
  ])('carries the matching directive for %p', async (content, directive) => {
    await orchestrator.processTurn({
      conversationId: 'conv-lang',
      channel: 'web',
      messages: [{ role: 'user', content }],
    });
    expect(capturedSystem).toContain(directive);
  });
});
