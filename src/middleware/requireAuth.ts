import { NextFunction, Request, Response } from 'express';
import { findUserById } from '../repositories/userRepository';
import { verifyAccessToken } from '../services/authService';

/**
 * Phase 11 — general backend authentication middleware.
 *
 * Verifies the short-lived access JWT (server-only secret, iss/aud/expiry
 * checked in authService) and exposes the verified user. Secrets, tokens,
 * and hashes are never logged.
 */
export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; name?: string | null };
}

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ') || header.length <= 'Bearer '.length) {
    res.status(401).json({
      success: false,
      error: { message: 'Authentication required', code: 401 },
    });
    return;
  }
  try {
    const verified = verifyAccessToken(header.slice('Bearer '.length));
    const user = await findUserById(verified.userId);
    if (!user || user.status !== 'active') {
      res.status(401).json({
        success: false,
        error: { message: 'Invalid or expired credentials', code: 401 },
      });
      return;
    }
    req.user = { id: user.id, email: user.email, name: user.name ?? null };
    next();
  } catch (err: any) {
    const status = err && typeof err.status === 'number' ? err.status : 401;
    res.status(status).json({
      success: false,
      error: { message: 'Invalid or expired credentials', code: status },
    });
  }
};
