import { Router } from 'express';
import {
  resolveConversationIdentity,
  requireOwnedConversation,
} from '../middleware/conversationIdentity';
import {
  generalConversationRateLimit,
  messageSendRateLimit,
} from '../middleware/chatRateLimit';
import {
  abandonConversationHandler,
  completeConversationHandler,
  createConversationHandler,
  getConversationHandler,
  getConversationQualificationHandler,
  getConversationStateHandler,
  listConversationMessagesHandler,
  listConversationsHandler,
  postConversationMessageHandler,
  postConversationQualificationHandler,
} from '../controllers/conversationController';
import {
  getConversationAvailabilityHandler,
  postConversationBookingHandler,
} from '../controllers/conversationCalendarController';

const router = Router();

// Phase 11: real authentication (short-lived access JWT) with a legacy
// pasted-token fallback for dev/test only (forced off in production).
// Identity resolution runs for every route; ownership enforcement runs for
// every :id route (resource-hiding 404s). Rate limits apply only to this
// router.
router.use(resolveConversationIdentity);
router.use(generalConversationRateLimit);

router.post('/', createConversationHandler);
router.get('/', listConversationsHandler);
router.get('/:id', requireOwnedConversation, getConversationHandler);
router.get('/:id/messages', requireOwnedConversation, listConversationMessagesHandler);
router.post(
  '/:id/messages',
  requireOwnedConversation,
  messageSendRateLimit,
  postConversationMessageHandler
);
router.post('/:id/complete', requireOwnedConversation, completeConversationHandler);
router.post('/:id/abandon', requireOwnedConversation, abandonConversationHandler);
// Phase 6: conversation qualification (same auth + ownership).
router.post('/:id/qualification', requireOwnedConversation, postConversationQualificationHandler);
router.get('/:id/qualification', requireOwnedConversation, getConversationQualificationHandler);
// Phase 8: explicit conversation meeting scheduling (same auth + ownership).
router.get('/:id/calendar/availability', requireOwnedConversation, getConversationAvailabilityHandler);
router.post('/:id/calendar/book', requireOwnedConversation, postConversationBookingHandler);
// Phase 9: structured logistics state for the conversation UI panel.
router.get('/:id/state', requireOwnedConversation, getConversationStateHandler);

export default router;
