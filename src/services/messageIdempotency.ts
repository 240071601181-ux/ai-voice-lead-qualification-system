/**
 * Idempotency for POST /api/v1/conversations/:id/messages.
 *
 * One logical submit (one `Idempotency-Key` header) persists exactly one
 * user message + one assistant message, even if the client POSTs twice
 * (double submit, timeout-then-retry). Distinct keys always produce
 * distinct messages — two genuinely identical texts are never merged.
 *
 * Keys are scoped per conversation by the caller (`${conversationId}:${key}`).
 * In-memory only (single Node process), consistent with the existing
 * rate-limiter stores: entries expire after TTL and the map is bounded.
 * Replay returns the originally persisted rows (same ids), so refresh and
 * history stay consistent.
 */

export interface IdempotentTurnResult {
  conversation: unknown;
  userMessage: unknown;
  assistantMessage: unknown;
  qualification: unknown;
}

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;

interface Entry {
  status: 'pending' | 'done';
  promise?: Promise<IdempotentTurnResult>;
  payload?: IdempotentTurnResult;
  expiresAt: number;
}

const store = new Map<string, Entry>();

const prune = (): void => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
};

/** Accept any non-empty client key (UUID recommended), else null = no protection. */
export const normalizeIdempotencyKey = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const key = raw.trim();
  if (key.length === 0 || key.length > 128) return null;
  return key;
};

export const runIdempotent = async (
  key: string,
  fn: () => Promise<IdempotentTurnResult>
): Promise<{ result: IdempotentTurnResult; replayed: boolean }> => {
  prune();
  const existing = store.get(key);
  if (existing && existing.status === 'done' && existing.payload) {
    return { result: existing.payload, replayed: true };
  }
  if (existing && existing.status === 'pending' && existing.promise) {
    return { result: await existing.promise, replayed: true };
  }
  const entry: Entry = { status: 'pending', expiresAt: Date.now() + TTL_MS };
  entry.promise = (async () => {
    try {
      const payload = await fn();
      entry.status = 'done';
      entry.payload = payload;
      entry.promise = undefined;
      return payload;
    } catch (err) {
      // Failed turns are NOT cached: a retry gets a fresh attempt.
      store.delete(key);
      throw err;
    }
  })();
  store.set(key, entry);
  return { result: await entry.promise, replayed: false };
};

/** Test-only hook: clear cached turns without touching the database. */
export const resetIdempotencyForTests = (): void => {
  store.clear();
};
