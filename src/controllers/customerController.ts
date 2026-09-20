import { NextFunction, Response } from 'express';
import { getCustomerAccessConfig } from '../config';
import { ConversationRequest } from '../middleware/conversationIdentity';
import {
  clearSessionCookie,
  CustomerRequest,
  hashCustomerToken,
  issueCustomerSessionCookie,
  mintCustomerToken,
} from '../middleware/customerAuth';
import {
  createAccessToken,
  createCustomerSession,
  findLiveAccessToken,
  findLiveCustomerSession,
  revokeAccessTokensForConversation,
  revokeCustomerSession,
  revokeCustomerSessionsForConversation,
} from '../repositories/customerAccessRepository';
import { findConversationById } from '../repositories/conversationRepository';
import { logger } from '../utils/logger';

/**
 * Phase 20 — customer access endpoints (admin/customer separation).
 *
 * Share/revoke run as the INTERNAL conversation owner (mounted on
 * conversationRoutes behind ownership + internal role). Redeem/session
 * endpoints run on the customer router with the customer session cookie.
 * Raw tokens are returned exactly once (inside the share URL) and never
 * logged, never persisted, never re-readable.
 */

const shareUrlFor = (rawToken: string): string => {
  const origin = getCustomerAccessConfig().frontendOrigin.replace(/\/+$/, '');
  return `${origin}/chat/${rawToken}`;
};

/**
 * POST /api/v1/conversations/:id/customer-access (internal, owner only).
 * Issues a single-conversation bearer link. Ownership pre-checked by
 * requireOwnedConversation; internal role pre-checked by middleware.
 */
export const postCustomerAccessHandler = async (
  req: ConversationRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const conversation = req.conversation!;
    const cfg = getCustomerAccessConfig();
    const raw = mintCustomerToken();
    const expiresAt = new Date(Date.now() + cfg.accessTtlSec * 1000).toISOString();
    // Revoking older links on re-share keeps exactly one live link per
    // conversation: a shared URL never silently multiplies access.
    await revokeAccessTokensForConversation(conversation.id);
    await revokeCustomerSessionsForConversation(conversation.id);
    await createAccessToken({
      conversation_id: conversation.id,
      token_hash: hashCustomerToken(raw),
      expires_at: expiresAt,
    });
    logger.info('Customer access link issued', { conversationId: conversation.id });
    return res.status(201).json({
      success: true,
      data: { url: shareUrlFor(raw), expiresAt },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/v1/conversations/:id/customer-access/revoke (internal owner).
 * Revokes every access token and session for the conversation. Rows and
 * history are untouched — only future customer access is cut off.
 */
export const postRevokeCustomerAccessHandler = async (
  req: ConversationRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const conversation = req.conversation!;
    const [revokedTokens, revokedSessions] = await Promise.all([
      revokeAccessTokensForConversation(conversation.id),
      revokeCustomerSessionsForConversation(conversation.id),
    ]);
    logger.info('Customer access revoked', { conversationId: conversation.id });
    return res.json({ success: true, data: { revokedTokens, revokedSessions } });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/v1/customer/session { accessToken } — redeem a share link.
 * Rate-limited upstream (brute-force protection). Success mints a session,
 * sets the HttpOnly cookie, and returns a minimal conversation summary.
 * Failures are a generic 401 (no enumeration of why a token is bad).
 */
export const postCustomerSessionHandler = async (
  req: CustomerRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const raw =
      req.body && typeof req.body.accessToken === 'string'
        ? req.body.accessToken.trim()
        : '';
    if (!raw) {
      return res.status(401).json({
        success: false,
        error: { message: 'Customer authentication required', code: 401 },
      });
    }
    let grant = null;
    try {
      grant = await findLiveAccessToken(hashCustomerToken(raw));
    } catch {
      grant = null;
    }
    if (!grant) {
      return res.status(401).json({
        success: false,
        error: { message: 'Customer authentication required', code: 401 },
      });
    }
    const conversation = await findConversationById(grant.conversation_id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { message: 'Conversation not found', code: 404 },
      });
    }
    const cfg = getCustomerAccessConfig();
    const sessionRaw = mintCustomerToken();
    const expiresAt = new Date(Date.now() + cfg.sessionTtlSec * 1000).toISOString();
    await createCustomerSession({
      conversation_id: conversation.id,
      session_hash: hashCustomerToken(sessionRaw),
      expires_at: expiresAt,
    });
    issueCustomerSessionCookie(res, sessionRaw);
    return res.status(201).json({
      success: true,
      data: {
        conversation: {
          id: conversation.id,
          status: conversation.status,
          channel: conversation.channel,
        },
        expiresAt,
      },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/v1/customer/conversation — minimal own-conversation summary.
 * The session alone decides which conversation this is.
 */
export const getCustomerConversationHandler = async (
  req: CustomerRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const conversation = req.conversation!;
    return res.json({
      success: true,
      data: {
        id: conversation.id,
        status: conversation.status,
        channel: conversation.channel,
      },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/v1/customer/logout — revoke the presented session and clear
 * the cookie. Idempotent: always succeeds, even without a valid session.
 */
export const postCustomerLogoutHandler = async (
  req: CustomerRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const existing = req.customer;
    if (existing) {
      try {
        await revokeCustomerSession(existing.sessionId);
      } catch (err: any) {
        logger.error('Customer logout revoke failed safely', { error: err?.message });
      }
    }
    clearSessionCookie(res);
    return res.json({ success: true, data: { loggedOut: true } });
  } catch (err) {
    return next(err);
  }
};
