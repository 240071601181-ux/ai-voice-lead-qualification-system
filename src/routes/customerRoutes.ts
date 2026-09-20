import { Router } from 'express';
import {
  createChatRateLimit,
  generalConversationRateLimit,
  messageSendRateLimit,
} from '../middleware/chatRateLimit';
import {
  requireCustomerConversation,
  requireCustomerSession,
} from '../middleware/customerAuth';
import {
  getCustomerConversationHandler,
  postCustomerLogoutHandler,
  postCustomerSessionHandler,
} from '../controllers/customerController';
import {
  getConversationAvailabilityHandler,
  postConversationBookingHandler,
} from '../controllers/conversationCalendarController';
import {
  getConversationQualificationHandler,
  getConversationStateHandler,
  listConversationMessagesHandler,
  postConversationMessageHandler,
} from '../controllers/conversationController';
import { getCustomerAccessConfig } from '../config';

const router = Router();

/**
 * Phase 20 — external customer API (admin/customer separation).
 *
 * Authentication is the customer HttpOnly session cookie ONLY: internal
 * JWTs and legacy chat tokens are never consulted here, and no route takes
 * a client-supplied conversation/lead/user id — the session alone decides
 * identity (requireCustomerSession → requireCustomerConversation).
 *
 * Message/state/qualification/meeting handlers are the SAME functions the
 * internal conversation system uses (single AI implementation, single
 * orchestrator, same tools/RAG/persistence).
 */

// Strict redeem limiter: share tokens are high-entropy, but guessing must
// still be expensive. Tunable via CUSTOMER_REDEEM_* (defaults 20/min/IP).
const redeemRateLimit = createChatRateLimit(() => {
  const cfg = getCustomerAccessConfig();
  return {
    windowMs: cfg.redeemWindowMs,
    max: cfg.redeemMaxAttempts,
    message: 'Too many redemption attempts, please try again later',
  };
});

router.post('/session', redeemRateLimit, postCustomerSessionHandler);

// Everything below requires a live customer session + its conversation.
router.use(generalConversationRateLimit, requireCustomerSession, requireCustomerConversation);

router.get('/conversation', getCustomerConversationHandler);
router.get('/messages', listConversationMessagesHandler);
router.post('/messages', messageSendRateLimit, postConversationMessageHandler);
router.get('/state', getConversationStateHandler);
router.get('/qualification', getConversationQualificationHandler);
router.get('/meeting/availability', getConversationAvailabilityHandler);
router.post('/meeting/book', postConversationBookingHandler);
router.post('/logout', postCustomerLogoutHandler);

export default router;
