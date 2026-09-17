import { Router } from 'express';
import {
  handleGetDiagnostics,
  handleGetDocument,
  handleIngestDocument,
  handleListDocuments,
  handleSearchKnowledge
} from '../controllers/knowledgeController';

const router = Router();

router.post('/ingest', handleIngestDocument);
router.post('/search', handleSearchKnowledge);
router.get('/diagnostics', handleGetDiagnostics);
router.get('/documents', handleListDocuments);
router.get('/documents/:id', handleGetDocument);

export default router;
