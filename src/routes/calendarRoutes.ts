import { Router } from 'express';
import { checkAvailability, createBooking, getBooking, getDiagnostics, getSyncState, listBookings, runSync } from '../controllers/calendarController';

const router = Router();

router.post('/bookings', createBooking);
router.get('/bookings', listBookings);
router.get('/bookings/:id', getBooking);
router.get('/availability', checkAvailability);
router.post('/sync', runSync);
router.get('/sync-status', getSyncState);
router.get('/diagnostics', getDiagnostics);

export default router;
