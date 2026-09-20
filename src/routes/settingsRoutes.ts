import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { getWorkspaceSettings, patchWorkspaceSettings } from '../controllers/settingsController';

const router = Router();

// Phase 20 — internal admin API. Workspace settings are global
// configuration: reads for every internal role, writes ADMIN only.
router.use(requireAuth, requireRole('ADMIN', 'OPERATOR'));

router.get('/', getWorkspaceSettings);
router.patch('/', requireRole('ADMIN'), patchWorkspaceSettings);

export default router;
