import { NextFunction, Request, Response } from 'express';
import { getAuthConfig } from '../config';
import { Conversation } from '../models/Conversation';
import { findUserById } from '../repositories/userRepository';
import { verifyAccessToken } from '../services/authService';
import { verifyChatToken } from './conversationAuth';
import { findOwnedConversation } from '../repositories/conversationRepository';

/**
 * Phase 11 — conversation identity + ownership.
 *
 * Identity resolution (in order):
 *   1. Short-lived access JWT (server-only secret) → authenticated user.
 *   2. Legacy pasted CHAT_JWT (dev/test compatibility only; forced off in
 *      production) → legacy scope: unowned rows only, never another user's.
 *   3. Otherwise truthful 401.
 *
 * Ownership (`requireOwnedConversation`): every :id operation loads the
 * conversation scoped to the identity and returns 404 when missing OR not
 * owned (resource-hiding: other users' UUIDs are indistinguishable from
 * nonexistent ones). Legacy tokens see only rows with user_id NULL.
 */
export type ConversationActor =
  | { kind: 'user'; user: { id: string; email: string; name?: string | null } }
  | { kind: 'legacy'; subject: string };

export interface ConversationRequest extends Request {
  auth?: ConversationActor;
  conversation?: Conversation;
}

const unauthorized = (res: Response, message: string): void => {
  res.status(401).json({ success: false, error: { message, code: 401 } });
};

const notFound = (res: Response): void => {
  res.status(404).json({ success: false, error: { message: 'Conversation not found', code: 404 } });
};

const readBearer = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ') || header.length <= 'Bearer '.length) return null;
  return header.slice('Bearer '.length);
};

export const resolveConversationIdentity = async (
  req: ConversationRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = readBearer(req);
  if (token) {
    try {
      const verified = verifyAccessToken(token);
      const user = await findUserById(verified.userId);
      if (user && user.status === 'active') {
        req.auth = {
          kind: 'user',
          user: { id: user.id, email: user.email, name: user.name ?? null },
        };
        next();
        return;
      }
    } catch {
      // Fall through to the legacy compatibility path below.
    }
    try {
      if (getAuthConfig().allowChatJwtFallback) {
        const subject = verifyChatToken(token);
        req.auth = { kind: 'legacy', subject };
        next();
        return;
      }
    } catch {
      // Fall through to 401.
    }
  }
  unauthorized(res, 'Authentication required');
};

export const requireOwnedConversation = async (
  req: ConversationRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.auth) {
      unauthorized(res, 'Authentication required');
      return;
    }
    const id = req.params.id;
    if (!id || typeof id !== 'string') {
      notFound(res);
      return;
    }
    const scope =
      req.auth.kind === 'user' ? { kind: 'user' as const, userId: req.auth.user.id } : { kind: 'legacy' as const };
    const conversation = await findOwnedConversation(id, scope);
    if (!conversation) {
      notFound(res);
      return;
    }
    req.conversation = conversation;
    next();
  } catch (err) {
    next(err);
  }
};
