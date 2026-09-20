/**
 * Tamil-script deterministic extraction (file I/O preserves Tamil Unicode;
 * verified code-point round trip).
 *
 * Proves English-keyword patterns accept Tamil-script values, Tamil name /
 * unit / vehicle markers work, and pure-English behavior is untouched
 * (covered by the existing extraction suites).
 */
import { extractStateFromMessage, tamilDigitsToAscii } from '../agent/textStateExtraction';

describe('tamilDigitsToAscii', () => {
  it('converts Tamil digits to ASCII', () => {
    expect(tamilDigitsToAscii('௫௦௦')).toBe('500');
    expect(tamilDigitsToAscii('20000')).toBe('20000');
  });
});

describe('Tamil extraction', () => {
  it('extracts Tamil-script values behind English markers', () => {
    const update = extractStateFromMessage('Pickup சென்னை, destination பெங்களூரு.');
    expect(update.pickup_location).toBe('சென்னை');
    expect(update.destination).toBe('பெங்களூரு');
  });

  it('extracts Tamil customer names', () => {
    expect(extractStateFromMessage('என் பெயர் சந்தோஷ்.').customer_name).toBe('சந்தோஷ்');
    expect(extractStateFromMessage('My name is Santhosh.').customer_name).toBe('Santhosh');
  });

  it('extracts Tamil weight units and Tamil digits', () => {
    expect(extractStateFromMessage('500 கிலோ எலக்ட்ரானிக்ஸ் பொருட்கள்.').cargo_weight).toBe(500);
    expect(extractStateFromMessage('2 டன் சரக்கு.').cargo_weight).toBe(2000);
    expect(extractStateFromMessage('௫௦௦ கிலோ.').cargo_weight).toBe(500);
  });

  it('extracts Tamil cargo descriptions', () => {
    expect(extractStateFromMessage('500 கிலோ எலக்ட்ரானிக்ஸ் பொருட்கள்.').cargo_type).toBe(
      'எலக்ட்ரானிக்ஸ்'
    );
  });

  it('extracts budgets with Tamil currency markers', () => {
    expect(extractStateFromMessage('Budget 20000 ரூபாய்.').budget).toBe(20000);
    expect(extractStateFromMessage('My budget is 30000.').budget).toBe(30000);
  });

  it('maps Tamil vehicle words to canonical English values', () => {
    expect(extractStateFromMessage('எனக்கு ஒரு லாரி வேண்டும்.').vehicle_type).toBe('Lorry');
    expect(extractStateFromMessage('I need a truck.').vehicle_type).toBe('Truck');
  });

  it('does not extract places from pure Tamil sentences without markers', () => {
    // No dictionaries: pure-Tamil route phrases stay for the LLM tool path.
    const update = extractStateFromMessage('எனக்கு சென்னையிலிருந்து பெங்களூருக்கு பொருட்களை அனுப்ப வேண்டும்.');
    expect(update.pickup_location ?? null).toBeNull();
    expect(update.destination ?? null).toBeNull();
  });

  it('never lets trailing clauses pollute the destination', () => {
    expect(
      extractStateFromMessage('Pickup Chennai, destination Bangalore. Budget 20000.').destination
    ).toBe('Bangalore');
  });

  it('never captures a weight measure as the cargo description', () => {
    expect(extractStateFromMessage('Please move 2 tons of rice.').cargo_type).toBe('rice');
  });
});
