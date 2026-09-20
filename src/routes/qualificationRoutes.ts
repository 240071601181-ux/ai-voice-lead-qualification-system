import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import {
  createQualification,
  getQualificationByLead,
  getQualificationByIdHandler,
  listQualificationHandler,
} from '../controllers/qualificationController';

const router = Router();

// Phase 20 — internal admin API: authenticated internal users only.
router.use(requireAuth, requireRole('ADMIN', 'OPERATOR'));

// Phase 14 — POST / (call-anchored re-run for historical records) stays:
// the qualifications UI re-run targets call-associated rows. The
// /calls/:callId read is retired with the Calls UI (repository read stays
// for legacy enrichment).
router.post('/', createQualification);
// Phase 10: minimal read endpoints (list + by-id) for the qualifications UI.
router.get('/', listQualificationHandler);
router.get('/leads/:leadId', getQualificationByLead);
router.get('/:id', getQualificationByIdHandler);

export default router;