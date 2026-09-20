import { createHmac, randomBytes } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { getAuthConfig, getCustomerAccessConfig } from '../config';
import { ConversationRequest } from './conversationIdentity';
import { Conversation } from '../models/Conversation';
import { findConversationById } from '../repositories/conversationRepository';
import {
  findLiveCustomerSession,
  touchCustomerSession,
} from '../repositories/customerAccessRepository';
import { logger } from '../utils/logger';

/**
 * Phase 20 — customer (external chat) authentication.
 *
 * Customers NEVER hold internal JWTs. They hold opaque per-conversation
 * tokens/sessions whose raw values never persist (HMAC-SHA256 hashes only,
 * keyed by the server-only AUTH_JWT_SECRET — fail closed when unconfigured).
 * Every customer request resolves its conversation EXCLUSIVELY from the
 * session cookie; client-supplied conversation/lead/user ids are never
 * trusted (no such routes exist).
 */

export interface CustomerRequest extends ConversationRequest {
  customer?: { sessionId: string; conversationId: string };
}

const secretOrThrow = (): string => {
  const secret = getAuthConfig().jwtSecret;
  if (!secret) throw new Error('Authentication is not configured');
  return secret;
};

/** HMAC hash for token/session persistence and lookup. Never logged. */
export const hashCustomerToken = (raw: string): string =>
  createHmac('sha256', secretOrThrow()).update(raw).digest('hex');

/** 256-bit cryptographically random opaque token (64 hex chars). */
export const mintCustomerToken = (): string => randomBytes(32).toString('hex');

/** Minimal cookie parser (no dependency): name → value or null. */
export const readCookie = (req: Request, name: string): string | null => {
  const header = req.headers.cookie;
  if (!header || typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim() || null;
    }
  }
  return null;
};

export const customerCookieName = (): string => getCustomerAccessConfig().sessionCookieName;

const setSessionCookie = (res: Response, raw: string, maxAgeSec: number): void => {
  const cfg = getCustomerAccessConfig();
  const parts = [
    `${cfg.sessionCookieName}=${encodeURIComponent(raw)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.header('Set-Cookie', parts.join('; '));
};

export const clearSessionCookie = (res: Response): void => {
  const cfg = getCustomerAccessConfig();
  const parts = [
    `${cfg.sessionCookieName}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.header('Set-Cookie', parts.join('; '));
};

export const issueCustomerSessionCookie = (res: Response, raw: string): void => {
  setSessionCookie(res, raw, getCustomerAccessConfig().sessionTtlSec);
};

const denied = (res: Response): void => {
  res.status(401).json({
    success: false,
    error: { message: 'Customer authentication required', code: 401 },
  });
};

/**
 * Resolve the customer session from the HttpOnly cookie. Attaches
 * req.customer (session + conversation ids). Expired, revoked, or unknown
 * sessions fail closed with 401. Never consults Authorization headers.
 */
export const requireCustomerSession = async (
  req: CustomerRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const raw = readCookie(req, customerCookieName());
    if (!raw) {
      denied(res);
      return;
    }
    let session = null;
    try {
      session = await findLiveCustomerSession(hashCustomerToken(raw));
    } catch {
      denied(res);
      return;
    }
    if (!session) {
      denied(res);
      return;
    }
    req.customer = { sessionId: session.id, conversationId: session.conversation_id };
    try {
      await touchCustomerSession(session.id);
    } catch (err: any) {
      logger.error('Customer session touch failed (continuing)', { error: err?.message });
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Load the session's conversation as req.conversation for reuse of the
 * standard conversation handlers (same agent/orchestrator path as internal
 * turns). Missing conversations 404 — the session alone decides identity.
 */
export const requireCustomerConversation = async (
  req: CustomerRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.customer) {
      denied(res);
      return;
    }
    // Reuse the owned-conversation loader in session scope: the session's
    // conversation id is the ONLY id ever loaded here.
    const conversation: Conversation | null = await findConversationById(
      req.customer.conversationId
    );
    if (!conversation) {
      res.status(404).json({
        success: false,
        error: { message: 'Conversation not found', code: 404 },
      });
      return;
    }
    req.conversation = conversation;
    next();
  } catch (err) {
    next(err);
  }
};
