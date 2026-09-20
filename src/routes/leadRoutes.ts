import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { createLead, getLead, listLeads, updateLead } from '../controllers/leadController';

const router = Router();

// Phase 20 — internal admin API: authenticated internal users only.
// Customers (customer-session cookies, legacy chat tokens) fail closed.
router.use(requireAuth, requireRole('ADMIN', 'OPERATOR'));

router.post('/', createLead);
router.get('/', listLeads);
router.get('/:id', getLead);
router.patch('/:id', updateLead);

export default router;
