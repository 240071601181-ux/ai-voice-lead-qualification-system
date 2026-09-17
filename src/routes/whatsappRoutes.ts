import { Router } from 'express';
import { getDiagnostics, listDeliveries } from '../controllers/whatsappController';

const router = Router();

router.get('/diagnostics', getDiagnostics);
router.get('/deliveries', listDeliveries);

export default router;
