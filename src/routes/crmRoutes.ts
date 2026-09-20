import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { getDiagnostics, listSyncs, runSync } from '../controllers/crmController';

const router = Router();

// Phase 20 — internal admin API: authenticated internal users only.
router.use(requireAuth, requireRole('ADMIN', 'OPERATOR'));

router.get('/diagnostics', getDiagnostics);
router.post('/sync', runSync);
router.get('/syncs', listSyncs);

export default router;
