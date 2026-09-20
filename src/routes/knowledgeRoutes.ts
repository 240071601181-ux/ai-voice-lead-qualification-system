import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import {
  handleGetDiagnostics,
  handleGetDocument,
  handleIngestDocument,
  handleListDocuments,
  handleSearchKnowledge
} from '../controllers/knowledgeController';

const router = Router();

// Phase 20 — internal admin API. Ingest changes global company knowledge:
// ADMIN only. Reads/search stay available to every internal role.
router.use(requireAuth, requireRole('ADMIN', 'OPERATOR'));

router.post('/ingest', requireRole('ADMIN'), handleIngestDocument);
router.post('/search', handleSearchKnowledge);
router.get('/diagnostics', handleGetDiagnostics);
router.get('/documents', handleListDocuments);
router.get('/documents/:id', handleGetDocument);

export default router;
