import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { getDiagnostics, listDeliveries } from '../controllers/whatsappController';

const router = Router();

// Phase 20 — internal admin API: authenticated internal users only.
router.use(requireAuth, requireRole('ADMIN', 'OPERATOR'));

router.get('/diagnostics', getDiagnostics);
router.get('/deliveries', listDeliveries);

export default router;
