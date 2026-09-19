import { Router } from 'express';
import { getQualificationMixHandler } from '../controllers/dashboardController';

const router = Router();

router.get('/qualification-mix', getQualificationMixHandler);

export default router;
