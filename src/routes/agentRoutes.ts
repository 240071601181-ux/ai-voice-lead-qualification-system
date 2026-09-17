import { Router } from 'express';
import { getConfig, getHealth, patchConfig, pauseAgent, resumeAgent } from '../controllers/agentConfigController';

const router = Router();

router.get('/config', getConfig);
router.patch('/config', patchConfig);
router.post('/pause', pauseAgent);
router.post('/resume', resumeAgent);
router.get('/health', getHealth);

export default router;
