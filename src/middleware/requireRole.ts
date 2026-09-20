import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from './requireAuth';
import { InternalRole, normalizeRole } from '../models/User';
import { findUserById } from '../repositories/userRepository';

/**
 * Phase 20 — internal role enforcement (admin/customer separation).
 *
 * Internal APIs require an authenticated internal user (requireAuth first)
 * PLUS a sufficient role. Roles resolve server-side from the users table on
 * every request — never from client claims:
 * - ADMIN: full internal access, including global-config writes and
 *   customer-access issuance.
 * - OPERATOR: daily internal work (leads, conversations, qualification
 *   reads, integrations). Cannot change global configuration.
 * - Customers are NEVER users: no CUSTOMER role exists. Customer sessions
 *   are rejected here (401) — they belong on /api/v1/customer/* only.
 *
 * Missing/unknown stored roles safely normalize to OPERATOR (least
 * privilege; rows predating migration 018 keep working without ever
 * becoming silent admins).
 */

export interface RoleRequest extends AuthenticatedRequest {
  internalRole?: InternalRole;
  internalUserId?: string;
}

const unauthorized = (res: Response): void => {
  res.status(401).json({
    success: false,
    error: { message: 'Authentication required', code: 401 },
  });
};

const forbidden = (res: Response): void => {
  res.status(403).json({
    success: false,
    error: { message: 'Insufficient permissions', code: 403 },
  });
};

export const requireRole = (...roles: InternalRole[]) => {
  return async (req: RoleRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.internalUserId || req.user?.id;
      if (!userId) {
        unauthorized(res);
        return;
      }
      const row = await findUserById(userId);
      if (!row || row.status !== 'active') {
        unauthorized(res);
        return;
      }
      const role = normalizeRole(row.role);
      req.internalUserId = row.id;
      req.internalRole = role;
      if (!roles.includes(role)) {
        forbidden(res);
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};

/**
 * Internal-user gate for routers that resolve mixed identities
 * (resolveConversationIdentity accepts users AND legacy dev tokens):
 * customer sessions and legacy tokens fail closed here.
 */
export const requireInternalUser = async (
  req: RoleRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const actor = (req as { auth?: { kind: string; user?: { id: string } } }).auth;
    if (!actor || actor.kind !== 'user' || !actor.user?.id) {
      unauthorized(res);
      return;
    }
    req.internalUserId = actor.user.id;
    next();
  } catch (err) {
    next(err);
  }
};
