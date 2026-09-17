import { NextFunction, Request, Response } from 'express';
import { getAuthConfig } from '../config';

/**
 * Phase 11 — brute-force protection for credential endpoints.
 *
 * In-memory per-IP sliding window (single-process; sufficient for this
 * app's deployment model). Returns truthful 429 when exhausted. The window
 * store exposes a reset hook for tests.
 */
interface AttemptWindow {
  count: number;
  resetAt: number;
}

const windows = new Map<string, AttemptWindow>();

const clientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return (req as any).ip || req.socket?.remoteAddress || 'unknown';
};

export const loginRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const cfg = getAuthConfig();
  const key = clientIp(req);
  const now = Date.now();
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + cfg.loginWindowMs });
    next();
    return;
  }
  existing.count += 1;
  if (existing.count > cfg.loginMaxAttempts) {
    res.status(429).json({
      success: false,
      error: { message: 'Too many login attempts. Please wait a moment.', code: 429 },
    });
    return;
  }
  next();
};

/** Test-only hook: clears all tracked windows. */
export const resetLoginRateLimitsForTests = (): void => {
  windows.clear();
};
