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
  listConversationMessagesHandler,
  listConversationsHandler,
  postConversationMessageHandler,
  postConversationQualificationHandler,
} from '../controllers/conversationController';

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

export default router;
