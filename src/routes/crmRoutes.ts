import { Router } from 'express';
import { getDiagnostics, listSyncs, runSync } from '../controllers/crmController';

const router = Router();

router.get('/diagnostics', getDiagnostics);
router.post('/sync', runSync);
router.get('/syncs', listSyncs);

export default router;
