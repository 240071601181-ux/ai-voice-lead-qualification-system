/**
 * Message idempotency: same key replays the persisted result, new keys
 * create new rows, failures are never cached.
 */
import {
  normalizeIdempotencyKey,
  resetIdempotencyForTests,
  runIdempotent,
} from '../services/messageIdempotency';

describe('normalizeIdempotencyKey', () => {
  it('accepts client UUID-style keys and rejects junk', () => {
    expect(normalizeIdempotencyKey('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    );
    expect(normalizeIdempotencyKey('  abc  ')).toBe('abc');
    expect(normalizeIdempotencyKey('')).toBeNull();
    expect(normalizeIdempotencyKey('   ')).toBeNull();
    expect(normalizeIdempotencyKey(undefined)).toBeNull();
    expect(normalizeIdempotencyKey(123)).toBeNull();
    expect(normalizeIdempotencyKey('x'.repeat(129))).toBeNull();
  });
});

describe('runIdempotent', () => {
  beforeEach(() => {
    resetIdempotencyForTests();
  });

  it('processes once and replays the same result for the same key', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return { conversation: {}, userMessage: { id: 'u1' }, assistantMessage: { id: 'a1' }, qualification: null };
    };
    const first = await runIdempotent('conv-1:key-1', fn);
    const second = await runIdempotent('conv-1:key-1', fn);
    expect(calls).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.result).toEqual(first.result);
  });

  it('treats new keys as new legitimate work (identical content allowed)', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return { conversation: {}, userMessage: { id: `u${calls}` }, assistantMessage: {}, qualification: null };
    };
    await runIdempotent('conv-1:key-a', fn);
    await runIdempotent('conv-1:key-b', fn);
    expect(calls).toBe(2);
  });

  it('shares one in-flight execution across concurrent duplicates', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { conversation: {}, userMessage: {}, assistantMessage: {}, qualification: null };
    };
    const [a, b] = await Promise.all([
      runIdempotent('conv-1:race', fn),
      runIdempotent('conv-1:race', fn),
    ]);
    expect(calls).toBe(1);
    expect(a.result).toEqual(b.result);
  });

  it('does not cache failures: a retry reprocesses', async () => {
    let calls = 0;
    const fail = async () => {
      calls += 1;
      throw new Error('boom');
    };
    await expect(runIdempotent('conv-1:fail', fail)).rejects.toThrow('boom');
    const ok = async () => {
      calls += 1;
      return { conversation: {}, userMessage: {}, assistantMessage: {}, qualification: null };
    };
    const retried = await runIdempotent('conv-1:fail', ok);
    expect(calls).toBe(2);
    expect(retried.replayed).toBe(false);
  });
});
