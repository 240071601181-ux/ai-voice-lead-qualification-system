import { Router } from 'express';
import {
  createQualification,
  getQualificationByCall,
  getQualificationByIdHandler,
  getQualificationByLead,
  listQualificationHandler,
} from '../controllers/qualificationController';

const router = Router();

router.post('/', createQualification);
// Phase 10: minimal read endpoints (list + by-id) for the qualifications UI.
router.get('/', listQualificationHandler);
router.get('/calls/:callId', getQualificationByCall);
router.get('/leads/:leadId', getQualificationByLead);
router.get('/:id', getQualificationByIdHandler);

export default router;