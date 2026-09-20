import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { getDiagnostics, listWorkflows } from '../controllers/n8nController';

const router = Router();

// Phase 20 — internal admin API: authenticated internal users only.
// (n8n itself is untouched: outbound delivery configuration and behavior
// are unchanged; only dashboard visibility is now authenticated.)
router.use(requireAuth, requireRole('ADMIN', 'OPERATOR'));

router.get('/diagnostics', getDiagnostics);
router.get('/workflows', listWorkflows);

export default router;
