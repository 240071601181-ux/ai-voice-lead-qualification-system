/**
 * Phase 4/5 fix: explicit negations, correction precedence, full cargo
 * descriptions, multi-requirement preservation, and weekday required_dates.
 *
 * Deterministic and DB-free: extraction + merge + validator only.
 * Vapi/call compatibility is covered by the existing suites (run green).
 */
import {
  extractStateFromMessage,
  formatStateDate,
  mergeTextConversationState,
  resolveWeekdayDate,
  unionRequirementTokens,
  validateTextStateUpdate,
} from '../agent/textStateExtraction';

// Fixed reference Friday so weekday math is deterministic.
const FRI_2026_09_18 = new Date(2026, 8, 18);
const opts = { now: FRI_2026_09_18 };

describe('A. explicit negation → non-urgent (never urgent)', () => {
  it.each([
    'not an emergency',
    'it is not an emergency',
    'this is not urgent',
    "it isn't urgent",
    'no urgency',
    'not time-sensitive',
    'no rush',
    'The shipment is required next Tuesday, but it is not an emergency.',
  ])('"%s" extracts urgency=normal', (message) => {
    expect(extractStateFromMessage(message, opts).urgency).toBe('normal');
  });

  it('genuine urgency still works', () => {
    expect(extractStateFromMessage('This is urgent, need it ASAP', opts).urgency).toBe('urgent');
    expect(extractStateFromMessage('There is an emergency shortage', opts).urgency).toBe('urgent');
  });
});

describe('B. correction precedence (new explicit values override)', () => {
  it('urgent → normal after an explicit correction', () => {
    const merged = mergeTextConversationState(
      { urgency: 'urgent' },
      extractStateFromMessage('Actually it is not an emergency.', opts)
    );
    expect(merged.urgency).toBe('normal');
  });

  it('pickup Chennai → Tambaram on correction', () => {
    const merged = mergeTextConversationState(
      { pickup_location: 'Chennai' },
      extractStateFromMessage('Actually pickup is Tambaram.', opts)
    );
    expect(merged.pickup_location).toBe('Tambaram');
  });

  it('generic cargo → full corrected description', () => {
    const merged = mergeTextConversationState(
      { cargo_type: 'general goods' },
      extractStateFromMessage(
        'Actually it is temperature-sensitive pharmaceutical equipment.',
        opts
      )
    );
    expect(merged.cargo_type).toBe('temperature-sensitive pharmaceutical equipment');
  });
});

describe('C. full cargo string preservation (no truncation)', () => {
  it('keeps the complete 45-char description via "cargo is"', () => {
    const update = extractStateFromMessage(
      'Actually, the cargo is temperature-sensitive pharmaceutical equipment.',
      opts
    );
    expect(update.cargo_type).toBe('temperature-sensitive pharmaceutical equipment');
  });

  it('keeps it via the "move <weight> of X" form without swallowing the route', () => {
    const update = extractStateFromMessage(
      'I need to move 2.5 tons of temperature-sensitive pharmaceutical equipment from Tambaram to Whitefield.',
      opts
    );
    expect(update.cargo_type).toBe('temperature-sensitive pharmaceutical equipment');
    expect(update.pickup_location).toBe('Tambaram');
    expect(update.destination).toBe('Whitefield');
  });

  it('prefers the real description when a later "cargo is <adjective>" also matches', () => {
    // "cargo is fragile" matches the first alternative but yields nothing
    // usable; it must not shadow the "move <weight> of X" description.
    const update = extractStateFromMessage(
      'I need to move 2.5 tons of temperature-sensitive pharmaceutical equipment ' +
        'from Tambaram, Chennai to Whitefield, Bengaluru next Tuesday. ' +
        'I need a vehicle with proper protection because the cargo is fragile, ' +
        'and my budget is around Rs.35,000.',
      opts
    );
    expect(update.cargo_type).toBe('temperature-sensitive pharmaceutical equipment');
    expect(update.pickup_location).toBe('Tambaram');
    expect(update.destination).toBe('Whitefield');
    expect(update.cargo_weight).toBe(2500);
    expect(update.budget).toBe(35000);
    expect(update.required_date).toBe('2026-09-22');
    expect(update.additional_requirements).toBe('fragile');
  });

  it('fits the VARCHAR(100) column and passes the shared validator', () => {
    const cargo = 'temperature-sensitive pharmaceutical equipment';
    expect(cargo.length).toBeLessThanOrEqual(100);
    const validated = validateTextStateUpdate({ cargo_type: cargo });
    expect(validated.sanitized.cargo_type).toBe(cargo);
  });
});

describe('D. multiple requirements preserved (fragile + temperature control)', () => {
  it('captures both signals in one message', () => {
    const update = extractStateFromMessage(
      'It is fragile, but temperature control is important too.',
      opts
    );
    expect(update.additional_requirements).toBe('fragile; temperature control important');
    // Handling adjectives must not pollute cargo_type.
    expect(update.cargo_type).toBeUndefined();
  });

  it('unions across turns instead of clobbering', () => {
    expect(
      unionRequirementTokens('fragile', 'temperature control important')
    ).toBe('fragile; temperature control important');
    const merged = mergeTextConversationState(
      { additional_requirements: 'fragile' },
      { additional_requirements: 'temperature control important' }
    );
    expect(merged.additional_requirements).toBe('fragile; temperature control important');
  });
});

describe('E. required date independent from urgency', () => {
  it('resolves "next Tuesday" from Friday 2026-09-18 to 2026-09-22', () => {
    expect(resolveWeekdayDate('Shipment required next Tuesday', FRI_2026_09_18)).toBe(
      '2026-09-22'
    );
  });

  it('"next Tuesday, but not an emergency" sets date AND normal urgency', () => {
    const update = extractStateFromMessage(
      'The shipment is required next Tuesday, but it is not an emergency.',
      opts
    );
    expect(update.required_date).toBe('2026-09-22');
    expect(update.urgency).toBe('normal');
  });

  it('ISO dates still win and never touch urgency', () => {
    const update = extractStateFromMessage('Deliver by 2026-10-01 please.', opts);
    expect(update.required_date).toBe('2026-10-01');
    expect(update.urgency).toBeUndefined();
  });
});

describe('G. state dates render as short ISO dates (never GMT strings)', () => {
  it('formats ISO strings, pg Dates, and nulls', () => {
    expect(formatStateDate('2026-09-22')).toBe('2026-09-22');
    expect(formatStateDate('2026-09-21T18:30:00.000Z')).toBe('2026-09-21');
    expect(formatStateDate(new Date(2026, 8, 22))).toBe('2026-09-22');
    expect(formatStateDate(null)).toBeNull();
    expect(formatStateDate('')).toBeNull();
    const rendered = formatStateDate(new Date(2026, 8, 22)) as string;
    expect(rendered).not.toContain('GMT');
  });
});

describe('F. merge preserves unrelated values, updates corrected fields', () => {
  it('matches the specified merge scenario', () => {
    const existing = {
      pickup_location: 'Tambaram',
      destination: 'Whitefield',
      cargo_weight: 2500,
      budget: 35000,
      urgency: 'urgent',
    };
    const incoming = extractStateFromMessage(
      'Actually, the cargo is temperature-sensitive pharmaceutical equipment. ' +
        'It is fragile, but temperature control is important too. ' +
        'The shipment is required next Tuesday, but it is not an emergency.',
      opts
    );
    const merged = mergeTextConversationState(existing, incoming);
    expect(merged).toMatchObject({
      pickup_location: 'Tambaram',
      destination: 'Whitefield',
      cargo_weight: 2500,
      budget: 35000,
      cargo_type: 'temperature-sensitive pharmaceutical equipment',
      additional_requirements: 'fragile; temperature control important',
      required_date: '2026-09-22',
      urgency: 'normal',
    });
  });
});
