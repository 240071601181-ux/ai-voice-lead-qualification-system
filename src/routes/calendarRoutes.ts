import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { checkAvailability, createBooking, getBooking, getDiagnostics, getSyncState, listBookings, runSync } from '../controllers/calendarController';

const router = Router();

// Phase 20 — internal admin API: authenticated internal users only.
// (Conversation-scoped meeting endpoints live on conversationRoutes and
// keep their ownership model untouched.)
router.use(requireAuth, requireRole('ADMIN', 'OPERATOR'));

router.post('/bookings', createBooking);
router.get('/bookings', listBookings);
router.get('/bookings/:id', getBooking);
router.get('/availability', checkAvailability);
router.post('/sync', runSync);
router.get('/sync-status', getSyncState);
router.get('/diagnostics', getDiagnostics);

export default router;
