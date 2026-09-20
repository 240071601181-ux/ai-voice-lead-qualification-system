/**
 * Deterministic memory answers: factual state questions get exactly the
 * requested field, never a full summary, never invented facts.
 */
import { findMemoryAnswers, isMemoryQuestion, isTamilContent } from '../agent/memoryAnswers';

const fullState = {
  customer_name: 'Santhosh',
  pickup_location: 'Chennai',
  destination: 'Bangalore',
  vehicle_type: '32ft truck',
  cargo_type: 'electronics',
  cargo_weight: 500,
  cargo_dimensions: null,
  required_date: null,
  budget: 30000,
  urgency: null,
  booking_intent: 'explicit' as const,
};

describe('findMemoryAnswers', () => {
  it('answers single-field questions concisely', () => {
    expect(findMemoryAnswers('What is my name?', fullState)).toEqual(['Your name is Santhosh.']);
    expect(findMemoryAnswers('What is my pickup location?', fullState)).toEqual([
      'Your pickup location is Chennai.',
    ]);
    expect(findMemoryAnswers('What is my destination?', fullState)).toEqual([
      'Your destination is Bangalore.',
    ]);
    expect(findMemoryAnswers('What vehicle did I ask for?', fullState)).toEqual([
      'You asked for a 32ft truck.',
    ]);
    expect(findMemoryAnswers('How much cargo am I sending?', fullState)).toEqual([
      "You're sending 500 kg of electronics.",
    ]);
    expect(findMemoryAnswers('What is my budget?', fullState)).toEqual(['Your budget is ₹30,000.']);
  });

  it('answers an explicit multi-question paste line by line', () => {
    expect(
      findMemoryAnswers(
        'What is my name?\nWhat is my pickup?\nWhat is my destination?',
        fullState
      )
    ).toEqual(['Your name is Santhosh.', 'Your pickup location is Chennai.', 'Your destination is Bangalore.']);
  });

  it('returns null when a asked field is unknown (normal LLM flow asks)', () => {
    expect(findMemoryAnswers('What is my name?', { ...fullState, customer_name: null })).toBeNull();
    expect(findMemoryAnswers('What is my budget?', { ...fullState, budget: null })).toBeNull();
  });

  it('returns null for statements (extraction handles those)', () => {
    expect(findMemoryAnswers('My budget is 30000', fullState)).toBeNull();
    expect(findMemoryAnswers('My name is Santhosh', fullState)).toBeNull();
    expect(findMemoryAnswers('Pickup is Chennai', fullState)).toBeNull();
  });

  it('returns null for mixed content and full summaries', () => {
    expect(findMemoryAnswers('My name is Santhosh. What is my budget?', fullState)).toBeNull();
    expect(findMemoryAnswers('Give me all my shipment details.', fullState)).toBeNull();
    expect(findMemoryAnswers('', fullState)).toBeNull();
    expect(findMemoryAnswers('What is my name?', null)).toBeNull();
  });

  it('dedupes repeated questions instead of failing', () => {
    expect(findMemoryAnswers('What is my name?\nWhat is my name?', fullState)).toEqual([
      'Your name is Santhosh.',
    ]);
  });
});

describe('isMemoryQuestion', () => {
  it('detects memory questions regardless of known values', () => {
    expect(isMemoryQuestion('What is my name?')).toBe(true);
    expect(isMemoryQuestion('What vehicle did I ask for?')).toBe(true);
    expect(isMemoryQuestion('How much cargo am I sending?')).toBe(true);
    expect(isMemoryQuestion('What is my name? What is my pickup?')).toBe(true);
  });

  it('rejects statements, mixed content, and knowledge questions', () => {
    expect(isMemoryQuestion('My budget is 30000')).toBe(false);
    expect(isMemoryQuestion('Hi, I need a truck')).toBe(false);
    expect(isMemoryQuestion('What vehicles do you provide?')).toBe(false);
    expect(isMemoryQuestion('My name is Santhosh. What is my budget?')).toBe(false);
    expect(isMemoryQuestion('What is my name? What vehicles do you provide?')).toBe(false);
  });
});

describe('Tamil memory questions', () => {
  const tamilState = {
    ...fullState,
    customer_name: 'சந்தோஷ்',
    pickup_location: 'சென்னை',
    destination: 'பெங்களூரு',
    vehicle_type: 'லாரி',
    cargo_type: 'எலக்ட்ரானிக்ஸ்',
  };

  it('detects Tamil as Tamil content', () => {
    expect(isTamilContent('என்னுடைய பெயர் என்ன?')).toBe(true);
    expect(isTamilContent('What is my name?')).toBe(false);
  });

  it('answers Tamil field questions in Tamil', () => {
    expect(findMemoryAnswers('என்னுடைய பெயர் என்ன?', tamilState)).toEqual([
      'உங்கள் பெயர் சந்தோஷ்.',
    ]);
    expect(findMemoryAnswers('என்னுடைய pickup location என்ன?', tamilState)).toEqual([
      'உங்கள் pickup: சென்னை.',
    ]);
  });

  it('returns null for Tamil knowledge questions (RAG path owns them)', () => {
    expect(
      findMemoryAnswers('நீங்கள் எந்த வகையான வாகனங்களை வழங்குகிறீர்கள்?', tamilState)
    ).toBeNull();
  });

  it('returns null when the Tamil-asked field is unknown', () => {
    expect(
      findMemoryAnswers('என்னுடைய பெயர் என்ன?', { ...tamilState, customer_name: null })
    ).toBeNull();
  });
});
