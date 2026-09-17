import { Router } from 'express';
import { requireConversationAuth } from '../middleware/conversationAuth';
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

// All conversation endpoints require a bearer token. Rate limits apply only
// to this router — Vapi webhooks and legacy routes are unaffected.
router.use(requireConversationAuth);
router.use(generalConversationRateLimit);

router.post('/', createConversationHandler);
router.get('/', listConversationsHandler);
router.get('/:id', getConversationHandler);
router.get('/:id/messages', listConversationMessagesHandler);
router.post('/:id/messages', messageSendRateLimit, postConversationMessageHandler);
router.post('/:id/complete', completeConversationHandler);
router.post('/:id/abandon', abandonConversationHandler);
// Phase 6: conversation qualification (same chat auth + rate limits).
router.post('/:id/qualification', postConversationQualificationHandler);
router.get('/:id/qualification', getConversationQualificationHandler);
// Phase 8: explicit conversation meeting scheduling (same chat auth + rate limits).
router.get('/:id/calendar/availability', getConversationAvailabilityHandler);
router.post('/:id/calendar/book', postConversationBookingHandler);
// Phase 9: structured logistics state for the conversation UI panel.
router.get('/:id/state', getConversationStateHandler);

export default router;
