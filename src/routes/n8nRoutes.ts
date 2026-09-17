import { Router } from 'express';
import { getDiagnostics, listWorkflows } from '../controllers/n8nController';

const router = Router();

router.get('/diagnostics', getDiagnostics);
router.get('/workflows', listWorkflows);

export default router;
