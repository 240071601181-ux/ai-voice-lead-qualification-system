import { NextFunction, Response } from 'express';
import { getAuthConfig } from '../config';
import { AuthenticatedRequest } from '../middleware/requireAuth';
import {
  getAuthenticatedUser,
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
  renameAuthenticatedUser,
} from '../services/authService';
import { logger } from '../utils/logger';

/**
 * Phase 11 — first-party auth endpoints. Validation + HTTP mapping only.
 * Never returns password hashes; never exposes signing secrets.
 */
const REFRESH_COOKIE_OPTIONS = () => {
  const cfg = getAuthConfig();
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/api/v1/auth',
    maxAge: cfg.refreshTtlSec * 1000,
  };
};

const setRefreshCookie = (res: Response, token: string): void => {
  const cfg = getAuthConfig();
  res.cookie(cfg.refreshCookieName, token, REFRESH_COOKIE_OPTIONS());
};

const clearRefreshCookie = (res: Response): void => {
  const cfg = getAuthConfig();
  res.clearCookie(cfg.refreshCookieName, { ...REFRESH_COOKIE_OPTIONS(), maxAge: undefined });
};

const readRefreshCookie = (req: AuthenticatedRequest): string | null => {
  const cfg = getAuthConfig();
  const raw = (req as any).cookies?.[cfg.refreshCookieName];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  // Fallback: manual Cookie header parse (no cookie-parser dependency).
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;
  const prefix = `${cfg.refreshCookieName}=`;
  const pair = header.split(';').find((s) => s.trim().startsWith(prefix));
  const value = pair?.trim().slice(prefix.length);
  return value && value.length > 0 ? decodeURIComponent(value) : null;
};

export const registerHandler = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { email, password, name } = (req.body || {}) as Record<string, unknown>;
    const issued = await registerUser({ email, password, name });
    setRefreshCookie(res, issued.refreshToken);
    logger.info('User registered', { userId: issued.user.id });
    return res.status(201).json({
      success: true,
      data: {
        user: issued.user,
        accessToken: issued.accessToken,
        accessExpiresAt: issued.accessExpiresAt,
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const loginHandler = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { email, password } = (req.body || {}) as Record<string, unknown>;
    const issued = await loginUser({ email, password });
    setRefreshCookie(res, issued.refreshToken);
    logger.info('User logged in', { userId: issued.user.id });
    return res.json({
      success: true,
      data: {
        user: issued.user,
        accessToken: issued.accessToken,
        accessExpiresAt: issued.accessExpiresAt,
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const refreshHandler = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const issued = await refreshSession(readRefreshCookie(req));
    setRefreshCookie(res, issued.refreshToken);
    return res.json({
      success: true,
      data: {
        user: issued.user,
        accessToken: issued.accessToken,
        accessExpiresAt: issued.accessExpiresAt,
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const logoutHandler = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await logoutSession(readRefreshCookie(req));
    clearRefreshCookie(res);
    return res.json({ success: true, data: { loggedOut: true } });
  } catch (err) {
    return next(err);
  }
};

export const meHandler = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Authentication required', code: 401 },
      });
    }
    const user = await getAuthenticatedUser(req.user.id);
    return res.json({ success: true, data: user });
  } catch (err) {
    return next(err);
  }
};

/**
 * Phase 17 — PATCH /api/v1/auth/me { name }: rename only. The service
 * ignores every other body field, so protected fields (id, email,
 * password_hash, status, ownership) can never change through this route.
 */
export const updateMeHandler = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Authentication required', code: 401 },
      });
    }
    const user = await renameAuthenticatedUser(req.user.id, (req.body || {}).name);
    return res.json({ success: true, data: user });
  } catch (err) {
    return next(err);
  }
};
