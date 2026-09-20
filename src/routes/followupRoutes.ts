import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { cancel, executeDue, executeOne, getById, list, retry, schedule } from '../controllers/followupController';

const router = Router();

// Phase 20 — internal admin API: authenticated internal users only
// (this also satisfies the Phase 13 note: authentication now exists).
router.use(requireAuth, requireRole('ADMIN', 'OPERATOR'));

router.post('/schedule', schedule);
router.get('/', list);
router.get('/:id', getById);
router.post('/:id/execute', executeOne);
router.post('/:id/cancel', cancel);
router.post('/:id/retry', retry);

/**
 * INTERNAL/admin execution endpoint for a future scheduler/worker.
 * Not a public API for arbitrary external callers: restrict network access
 * until authentication infrastructure exists (out of scope for Phase 13).
 */
router.post('/execute-due', executeDue);

export default router;
