import { NextFunction, Request, Response } from 'express';

/**
 * Minimal in-memory sliding-window rate limiter (Phase 3).
 *
 * The repo has no rate-limiting dependency or equivalent, and the hand-rolled
 * approach matches existing conventions (custom CORS, custom validators).
 * Applied ONLY to the conversation router. Limits come from the environment
 * per request so tests can reconfigure without module reloads.
 *
 * Single-instance memory store: suitable as abuse protection in front of a
 * single Node process. Documented limitation — use a shared store when
 * scaling horizontally (Phase 10 hardening).
 */

export interface ChatRateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
}

const numberOr = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** All live bucket stores, so tests can reset every limiter at once. */
const bucketRegistry = new Set<Map<string, number[]>>();

/** Test hook: clear all recorded hits across limiters. */
export const resetChatRateLimitsForTests = (): void => {
  for (const buckets of bucketRegistry) buckets.clear();
};

export const createChatRateLimit = (resolveOptions: () => ChatRateLimitOptions) => {
  // Per-limiter store: general traffic never consumes the message budget.
  const buckets = new Map<string, number[]>();
  bucketRegistry.add(buckets);
  return (req: Request, res: Response, next: NextFunction) => {
    const { windowMs, max, message } = resolveOptions();
    const key = req.ip || 'unknown';
    const now = Date.now();
    const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      return res.status(429).json({
        success: false,
        error: { message: message || 'Too many requests, please slow down', code: 429 },
      });
    }
    hits.push(now);
    buckets.set(key, hits);
    // Opportunistic prune so the map cannot grow without bound.
    if (buckets.size > 10000) {
      for (const [k, times] of buckets) {
        const fresh = times.filter((t) => now - t < windowMs);
        if (fresh.length === 0) buckets.delete(k);
        else buckets.set(k, fresh);
      }
    }
    return next();
  };
};

const windowMs = (): number => numberOr(process.env.CHAT_RATE_LIMIT_WINDOW_MS, 60000);

/** General guard for conversation reads and lifecycle calls. */
export const generalConversationRateLimit = createChatRateLimit(() => ({
  windowMs: windowMs(),
  max: numberOr(process.env.CHAT_RATE_LIMIT_MAX, 60),
}));

/** Stricter guard for LLM-backed message sends. */
export const messageSendRateLimit = createChatRateLimit(() => ({
  windowMs: windowMs(),
  max: numberOr(process.env.CHAT_MESSAGE_RATE_LIMIT_MAX, 20),
  message: 'Message rate limit exceeded, please try again shortly',
}));
