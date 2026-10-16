import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { getDashboardSummaryHandler, getQualificationMixHandler } from '../controllers/dashboardController';

const router = Router();

// Phase 20 — internal admin API: authenticated internal users only.
router.use(requireAuth, requireRole('ADMIN', 'USER'));

router.get('/qualification-mix', getQualificationMixHandler);
router.get('/summary', getDashboardSummaryHandler);

export default router;
