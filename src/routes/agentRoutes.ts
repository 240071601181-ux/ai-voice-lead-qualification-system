import { Router } from 'express';
import { getConfig, getHealth, patchConfig, pauseAgent, resumeAgent } from '../controllers/agentConfigController';
import { getAgentHealthMetricsHandler } from '../controllers/agentHealthController';

const router = Router();

router.get('/config', getConfig);
router.patch('/config', patchConfig);
router.post('/pause', pauseAgent);
router.post('/resume', resumeAgent);
router.get('/health', getHealth);
// Phase 15: real aggregate metrics (SQL counts/averages, never bodies).
router.get('/health-metrics', getAgentHealthMetricsHandler);

export default router;
