import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { getConfig, getHealth, patchConfig, pauseAgent, resumeAgent } from '../controllers/agentConfigController';
import { getAgentHealthMetricsHandler } from '../controllers/agentHealthController';

const router = Router();

// Phase 20 — internal admin API. Agent behavior controls are global
// configuration: reads/health for every internal role, writes ADMIN only.
router.use(requireAuth, requireRole('ADMIN', 'OPERATOR'));

router.get('/config', getConfig);
router.patch('/config', requireRole('ADMIN'), patchConfig);
router.post('/pause', requireRole('ADMIN'), pauseAgent);
router.post('/resume', requireRole('ADMIN'), resumeAgent);
router.get('/health', getHealth);
// Phase 15: real aggregate metrics (SQL counts/averages, never bodies).
router.get('/health-metrics', getAgentHealthMetricsHandler);

export default router;
