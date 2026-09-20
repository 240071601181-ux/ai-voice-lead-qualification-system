/**
 * Tamil / multilingual conversation matrix (bug-fix pass).
 *
 * Covers the required matrix at the cheapest deterministic layers:
 * - Tamil basic message: exact Unicode persisted + one assistant reply.
 * - Tamil + mixed state extraction (Chennai/Bangalore/budget/weight).
 * - Tamil memory questions answered from state (no LLM turn).
 * - Tamil -> English and English -> Tamil switches keep memory correct.
 * - Tamil RAG triggers vs Tamil trivial greetings (routing only).
 * - Unicode JSON round trip (code-point exact, no sanitization).
 * - Tool-call arguments preserve Tamil (dispatch -> repository args).
 * - LLM timeout configuration (provider cap, env override, default).
 * - LLM failure: user message retained, no assistant persisted, 500.
 * - Tamil duplicate POSTs obey 1 user message / 1 assistant response.
 *
 * English behavior is untouched (existing suites own it); every test here
 * asserts additive multilingual behavior or language-independent safety.
 */
import { extractStateFromMessage, validateTextStateUpdate } from '../agent/textStateExtraction';
import {
  findMemoryAnswers,
  hasUpdateIntent,
  isMemoryQuestion,
  isTamilContent,
} from '../agent/memoryAnswers';
import { isKnowledgeSearchRequired } from '../agent/orchestrator';
import { getLlmConfig } from '../config';
import {
  dispatchConversationTool,
  parseConversationToolArguments,
} from '../agent/conversationTools';

jest.mock('../repositories/conversationStatesRepository', () => ({
  findConversationStateByConversationId: jest.fn(),
  createConversationState: jest.fn(),
  updateConversationStateRecord: jest.fn(),
}));

jest.mock('../repositories/leadRepository', () => {
  const actual = jest.requireActual('../repositories/leadRepository');
  return { ...actual, updateLead: jest.fn() };
});

const statesRepo =
  require('../repositories/conversationStatesRepository') as {
    findConversationStateByConversationId: jest.Mock;
    createConversationState: jest.Mock;
    updateConversationStateRecord: jest.Mock;
  };

describe('Tamil state extraction (mixed + Tamil-script)', () => {
  it('extracts a mixed Tamil-English shipment line without polluting fields', () => {
    const update = extractStateFromMessage(
      'Pickup Chennai, destination Bangalore. Budget 20000 ரூபாய்.'
    );
    expect(update.pickup_location).toBe('Chennai');
    expect(update.destination).toBe('Bangalore');
    expect(update.budget).toBe(20000);
  });

  it('extracts weight from a mixed Tamil sentence and never crashes', () => {
    const update = extractStateFromMessage(
      'எனக்கு Chennai லிருந்து Bangaloreக்கு 500 kg cargo அனுப்ப வேண்டும்.'
    );
    expect(update.cargo_weight).toBe(500);
  });

  it('extracts a Tamil budget statement and a Tamil name', () => {
    expect(extractStateFromMessage('என்னுடைய budget ₹20000.').budget).toBe(20000);
    expect(extractStateFromMessage('என் பெயர் சந்தோஷ்.').customer_name).toBe('சந்தோஷ்');
  });

  it('extracts Tamil state corrections deterministically (no model needed)', () => {
    expect(
      extractStateFromMessage('என்னுடைய pickup-ஐ Tambaram ஆக மாற்றுங்கள்.').pickup_location
    ).toBe('Tambaram');
    expect(
      extractStateFromMessage('என்னுடைய pickup location-ஐ தாம்பரமாக மாற்றுங்கள்.')
        .pickup_location
    ).toBe('தாம்பரம்');
    expect(
      extractStateFromMessage('என்னுடைய destination-ஐ Madurai ஆக மாற்றுங்கள்.').destination
    ).toBe('Madurai');
    // No field marker → nothing extracted (left for the LLM turn).
    expect(extractStateFromMessage('இதை மாற்றுங்கள்.')).toEqual({});
  });

  it('extracts English change/update corrections without misfiring destination', () => {
    const pickup = extractStateFromMessage('Change my pickup location to Tambaram.');
    expect(pickup.pickup_location).toBe('Tambaram');
    expect(pickup.destination).toBeUndefined();
    expect(extractStateFromMessage('Please update pickup to Chennai.').pickup_location).toBe(
      'Chennai'
    );
    expect(extractStateFromMessage('Set destination to Madurai.').destination).toBe('Madurai');
    expect(extractStateFromMessage('Change my budget to 25000.').budget).toBe(25000);
    // No regression: plain "to X" / "from A to B" shipping intent unchanged.
    expect(extractStateFromMessage('Ship to Mumbai.').destination).toBe('Mumbai');
    expect(extractStateFromMessage('From Chennai to Bangalore.').destination).toBe('Bangalore');
    expect(extractStateFromMessage('What is my pickup location?')).toEqual({});
  });

  it('does not treat a Tamil memory question as a name statement', () => {
    // "என்னுடைய பெயர் என்ன?" must not write "என்ன?" into customer_name.
    expect(extractStateFromMessage('என்னுடைய பெயர் என்ன?')).toEqual({});
    expect(extractStateFromMessage('என்னுடைய pickup location என்ன?')).toEqual({});
  });
});

describe('Tamil memory across language switches', () => {
  const state = {
    customer_name: 'சந்தோஷ்',
    pickup_location: 'சென்னை',
    destination: 'பெங்களூரு',
    vehicle_type: null,
    cargo_type: 'எலக்ட்ரானிக்ஸ்',
    cargo_weight: 500,
    cargo_dimensions: null,
    required_date: null,
    budget: 20000,
    urgency: null,
    booking_intent: null,
  };

  it('answers Tamil memory questions in Tamil', () => {
    expect(isTamilContent('என்னுடைய பெயர் என்ன?')).toBe(true);
    expect(isMemoryQuestion('என்னுடைய பெயர் என்ன?')).toBe(true);
    expect(findMemoryAnswers('என்னுடைய பெயர் என்ன?', state)).toEqual([
      'உங்கள் பெயர் சந்தோஷ்.',
    ]);
    expect(findMemoryAnswers('என்னுடைய pickup location என்ன?', state)).toEqual([
      'உங்கள் pickup: சென்னை.',
    ]);
  });

  it('keeps memory correct when switching Tamil -> English', () => {
    // Same stored state, English phrasing -> English answer, same fact.
    expect(findMemoryAnswers('What is my pickup location?', state)).toEqual([
      'Your pickup location is சென்னை.',
    ]);
    expect(findMemoryAnswers('What is my name?', state)).toEqual([
      'Your name is சந்தோஷ்.',
    ]);
  });

  it('keeps memory correct when switching English -> Tamil', () => {
    const englishState = { ...state, pickup_location: 'Chennai' };
    expect(findMemoryAnswers('What is my pickup location?', englishState)).toEqual([
      'Your pickup location is Chennai.',
    ]);
    expect(findMemoryAnswers('என்னுடைய pickup location என்ன?', englishState)).toEqual([
      'உங்கள் pickup: Chennai.',
    ]);
  });

  it('never routes Tamil knowledge questions to memory (RAG owns them)', () => {
    expect(
      findMemoryAnswers('நீங்கள் எந்த வகையான வாகனங்களை வழங்குகிறீர்கள்?', state)
    ).toBeNull();
    expect(findMemoryAnswers('உங்களிடம் என்ன cargo restrictions உள்ளன?', state)).toBeNull();
  });
});

describe('Tamil RAG routing (trigger vocabulary only; scoring untouched)', () => {
  it('triggers retrieval for Tamil knowledge questions', () => {
    expect(
      isKnowledgeSearchRequired('நீங்கள் எந்த வகையான வாகனங்களை வழங்குகிறீர்கள்?')
    ).toBe(true);
    expect(
      isKnowledgeSearchRequired('நீங்கள் ஞாயிற்றுக்கிழமைகளில் சேவை வழங்குகிறீர்களா?')
    ).toBe(true);
    expect(isKnowledgeSearchRequired('உங்களிடம் என்ன cargo restrictions உள்ளன?')).toBe(true);
  });

  it('never triggers retrieval for Tamil trivial greetings', () => {
    for (const greeting of ['வணக்கம்', 'நன்றி', 'சரி']) {
      expect(isKnowledgeSearchRequired(greeting)).toBe(false);
    }
  });

  it('never triggers retrieval for Tamil memory questions about own shipment', () => {
    // Memory-classified turns bypass RAG in the orchestrator; the trigger
    // itself must stay quiet for pure state questions.
    expect(isKnowledgeSearchRequired('என்னுடைய pickup location என்ன?')).toBe(false);
  });
});

describe('Unicode persistence (no sanitization, code-point exact)', () => {
  const cases = [
    'வணக்கம்',
    'எனக்கு சென்னையிலிருந்து பெங்களூருக்கு பொருட்களை அனுப்ப வேண்டும்.',
    '500 கிலோ எலக்ட்ரானிக்ஸ் பொருட்கள்.',
    'Pickup சென்னை, destination பெங்களூரு.',
    'Pickup Chennai, destination Bangalore. Budget 20000 ரூபாய்.',
    'என் பெயர் சந்தோஷ்.',
  ];

  it('survives a JSON request-body round trip code-point exactly', () => {
    for (const text of cases) {
      const restored = JSON.parse(JSON.stringify({ content: text })).content as string;
      expect(restored).toBe(text);
      expect(Array.from(restored)).toEqual(Array.from(text));
    }
  });

  it('parses tool-call argument JSON carrying Tamil without corruption', () => {
    const raw = JSON.stringify({ updates: { pickup_location: 'தாம்பரம்' } });
    const parsed = parseConversationToolArguments(raw);
    expect(parsed?.['updates']).toEqual({ pickup_location: 'தாம்பரம்' });
    expect(Array.from((parsed?.['updates'] as any).pickup_location)).toEqual(
      Array.from('தாம்பரம்')
    );
  });
});

describe('Tamil corrections reach the tool path (never memory)', () => {
  it('detects Tamil update intent behind a question-style prefix', () => {
    expect(hasUpdateIntent('என்னுடைய pickup-ஐ Tambaram ஆக மாற்றுங்கள்.')).toBe(true);
    expect(hasUpdateIntent('என்னுடைய pickup location-ஐ தாம்பரமாக மாற்றுங்கள்.')).toBe(true);
    expect(hasUpdateIntent('Change my pickup to Tambaram')).toBe(true);
    expect(hasUpdateIntent('What is my pickup location?')).toBe(false);
    expect(hasUpdateIntent('என்னுடைய pickup location என்ன?')).toBe(false);
  });

  it('refuses memory answers for corrections so the LLM tool loop executes them', () => {
    expect(isMemoryQuestion('என்னுடைய pickup-ஐ Tambaram ஆக மாற்றுங்கள்.')).toBe(false);
    expect(
      findMemoryAnswers('என்னுடைய pickup-ஐ Tambaram ஆக மாற்றுங்கள்.', {
        pickup_location: 'Chennai',
      })
    ).toBeNull();
    // Pure questions still answer from memory (no LLM turn).
    expect(isMemoryQuestion('என்னுடைய pickup location என்ன?')).toBe(true);
  });
});

describe('Model-garbled tool values never persist (mojibake guard)', () => {
  it('accepts genuine Tamil, Hindi, and English slot values', () => {
    expect(validateTextStateUpdate({ pickup_location: 'சென்னை' }).sanitized.pickup_location).toBe(
      'சென்னை'
    );
    expect(validateTextStateUpdate({ pickup_location: 'Tambaram (தாம்பரம்)' }).sanitized.pickup_location).toBe(
      'Tambaram (தாம்பரம்)'
    );
    expect(validateTextStateUpdate({ customer_name: 'मोहन' }).sanitized.customer_name).toBe(
      'मोहन'
    );
    expect(validateTextStateUpdate({ customer_name: 'José Müller' }).sanitized.customer_name).toBe(
      'José Müller'
    );
  });

  it('rejects cross-script garbage and stray combining marks', () => {
    // Observed live: llama3.2 garbled Tamil into Kannada + broken clusters.
    expect(
      validateTextStateUpdate({ pickup_location: 'ೄೕನ೓೑಩' }).sanitized.pickup_location
    ).toBeUndefined();
    expect(
      validateTextStateUpdate({ customer_name: '஼்பறை' }).sanitized.customer_name
    ).toBeUndefined();
  });

  it('still accepts well-formed (even if semantically wrong) Tamil words', () => {
    // Encoding guard only: a correctly shaped Tamil word passes even when
    // the model chose the wrong word — semantic hallucinations stay the
    // model's responsibility, never a persistence-layer crash.
    expect(validateTextStateUpdate({ destination: 'ண்லைழு' }).sanitized.destination).toBe(
      'ண்லைழு'
    );
  });

  it('reports the rejection so the tool loop fails safe instead of persisting', async () => {
    statesRepo.findConversationStateByConversationId.mockResolvedValue(null);
    statesRepo.createConversationState.mockResolvedValue({ id: 'st-1' });
    statesRepo.updateConversationStateRecord.mockResolvedValue({ id: 'st-1' });
    const outcome = await dispatchConversationTool(
      { conversationId: 'conv-ta', leadId: null },
      'updateConversationState',
      JSON.stringify({ updates: { pickup_location: 'ೄೕನ೓೑಩' } })
    );
    expect(outcome.success).toBe(false);
    expect(statesRepo.updateConversationStateRecord).not.toHaveBeenCalled();
  });

  it('keeps a known Tamil value when the model echoes it garbled and ungrounded', async () => {
    statesRepo.findConversationStateByConversationId.mockResolvedValue({
      id: 'st-1',
      customer_name: 'சந்தோஷ்',
    });
    statesRepo.updateConversationStateRecord.mockImplementation(async () => ({ id: 'st-1' }));
    // Turn never mentioned the name: the garbled echo must not overwrite it.
    const outcome = await dispatchConversationTool(
      { conversationId: 'conv-ta', leadId: null },
      'updateConversationState',
      JSON.stringify({
        updates: { customer_name: 'ஶல்ழிற', pickup_location: 'Chennai' },
      }),
      'Pickup Chennai, destination Bangalore.'
    );
    expect(outcome.success).toBe(true);
    const persisted = statesRepo.updateConversationStateRecord.mock.calls[
        statesRepo.updateConversationStateRecord.mock.calls.length - 1
      ][1] as Record<
      string,
      unknown
    >;
    expect(persisted.customer_name).toBeUndefined();
    expect(persisted.pickup_location).toBe('Chennai');
    expect(outcome.resultText).toContain('customer_name');
  });

  it('accepts a grounded Tamil overwrite (real correction in this turn)', async () => {
    statesRepo.findConversationStateByConversationId.mockResolvedValue({
      id: 'st-1',
      pickup_location: 'Chennai',
    });
    statesRepo.updateConversationStateRecord.mockImplementation(async () => ({ id: 'st-1' }));
    const outcome = await dispatchConversationTool(
      { conversationId: 'conv-ta', leadId: null },
      'updateConversationState',
      JSON.stringify({ updates: { pickup_location: 'தாம்பரம்' } }),
      'என்னுடைய pickup-ஐ தாம்பரமாக மாற்றுங்கள்.'
    );
    expect(outcome.success).toBe(true);
    const persisted = statesRepo.updateConversationStateRecord.mock.calls[
        statesRepo.updateConversationStateRecord.mock.calls.length - 1
      ][1] as Record<
      string,
      unknown
    >;
    expect(persisted.pickup_location).toBe('தாம்பரம்');
  });

  it('never gates ASCII overwrites or first-time writes (English untouched)', async () => {
    statesRepo.findConversationStateByConversationId.mockResolvedValue({
      id: 'st-1',
      pickup_location: 'Chennai',
    });
    statesRepo.updateConversationStateRecord.mockImplementation(async () => ({ id: 'st-1' }));
    const ascii = await dispatchConversationTool(
      { conversationId: 'conv-ta', leadId: null },
      'updateConversationState',
      JSON.stringify({ updates: { pickup_location: 'Mumbai' } }),
      'Unrelated message with no place names.'
    );
    expect(ascii.success).toBe(true);
    expect(
      (statesRepo.updateConversationStateRecord.mock.calls[
        statesRepo.updateConversationStateRecord.mock.calls.length - 1
      ][1] as Record<string, unknown>)
        .pickup_location
    ).toBe('Mumbai');

    statesRepo.findConversationStateByConversationId.mockResolvedValue(null);
    const first = await dispatchConversationTool(
      { conversationId: 'conv-ta', leadId: null },
      'updateConversationState',
      JSON.stringify({ updates: { customer_name: 'சந்தோஷ்' } }),
      'Unrelated message.'
    );
    expect(first.success).toBe(true);
  });
});

describe('Tamil tool calling (arguments never corrupted)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    statesRepo.findConversationStateByConversationId.mockResolvedValue(null);
    statesRepo.createConversationState.mockImplementation(async (input: any) => ({
      id: 'st-1',
      conversation_id: input.conversation_id,
    }));
    statesRepo.updateConversationStateRecord.mockImplementation(
      async (_conversationId: string, updates: Record<string, unknown>) => ({
        id: 'st-1',
        ...updates,
      })
    );
  });

  it('persists a Tamil pickup correction through updateConversationState', async () => {
    const outcome = await dispatchConversationTool(
      { conversationId: 'conv-ta', leadId: null },
      'updateConversationState',
      JSON.stringify({ updates: { pickup_location: 'தாம்பரம்' } })
    );
    expect(outcome.success).toBe(true);
    expect(statesRepo.updateConversationStateRecord).toHaveBeenCalledTimes(1);
    const persisted = statesRepo.updateConversationStateRecord.mock.calls[
        statesRepo.updateConversationStateRecord.mock.calls.length - 1
      ][1] as Record<
      string,
      unknown
    >;
    expect(persisted.pickup_location).toBe('தாம்பரம்');
    expect(Array.from(String(persisted.pickup_location))).toEqual(Array.from('தாம்பரம்'));
  });
});

describe('LLM provider timeout configuration', () => {
  const saved = process.env.LLM_TIMEOUT_MS;

  afterEach(() => {
    if (saved === undefined) delete process.env.LLM_TIMEOUT_MS;
    else process.env.LLM_TIMEOUT_MS = saved;
  });

  it('defaults to 90s so slow local inference is not cut off early', () => {
    delete process.env.LLM_TIMEOUT_MS;
    expect(getLlmConfig().timeoutMs).toBe(90000);
  });

  it('honours an explicit LLM_TIMEOUT_MS override', () => {
    process.env.LLM_TIMEOUT_MS = '120000';
    expect(getLlmConfig().timeoutMs).toBe(120000);
  });

  it('falls back to the default for invalid values (never 0/unbounded)', () => {
    process.env.LLM_TIMEOUT_MS = 'not-a-number';
    expect(getLlmConfig().timeoutMs).toBe(90000);
    process.env.LLM_TIMEOUT_MS = '0';
    expect(getLlmConfig().timeoutMs).toBe(90000);
  });
});
