import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { getQualificationMixHandler } from '../controllers/dashboardController';

const router = Router();

// Phase 20 — internal admin API: authenticated internal users only.
router.use(requireAuth, requireRole('ADMIN', 'OPERATOR'));

router.get('/qualification-mix', getQualificationMixHandler);

export default router;
