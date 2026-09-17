import { Request, Response, NextFunction } from 'express';
import {
  getKnowledgeDiagnostics,
  getKnowledgeDocument,
  ingestDocument,
  listKnowledgeDocuments,
  searchKnowledge
} from '../services/knowledgeService';

export const handleIngestDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await ingestDocument(req.body);
    return res.status(201).json({
      success: true,
      data: result
    });
  } catch (err: any) {
    if (err.message && (err.message.includes('required') || err.message.includes('must be'))) {
      return res.status(400).json({
        success: false,
        error: { message: err.message, code: 400 }
      });
    }
    next(err);
  }
};

export const handleSearchKnowledge = async (req: Request, res: Response, Next: NextFunction) => {
  try {
    const result = await searchKnowledge(req.body);
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err: any) {
    if (err.message && err.message.includes('required')) {
      return res.status(400).json({
        success: false,
        error: { message: err.message, code: 400 }
      });
    }
    Next(err);
  }
};

/**
 * GET /api/v1/knowledge/documents?page=&limit=
 * Paginated inventory of real ingested documents (no demo rows).
 */
export const handleListDocuments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await listKnowledgeDocuments({
      page: req.query.page,
      limit: req.query.limit
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    if (err.message && (err.message.includes('page') || err.message.includes('limit'))) {
      return res.status(400).json({
        success: false,
        error: { message: err.message, code: 400 }
      });
    }
    next(err);
  }
};

/** GET /api/v1/knowledge/documents/:id — real document + stored chunks. */
export const handleGetDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getKnowledgeDocument(req.params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    if (err.status === 404) {
      return res.status(404).json({
        success: false,
        error: { message: err.message, code: 404 }
      });
    }
    if (err.message && err.message.includes('required')) {
      return res.status(400).json({
        success: false,
        error: { message: err.message, code: 400 }
      });
    }
    next(err);
  }
};

/**
 * GET /api/v1/knowledge/diagnostics — real store checks (database, tables,
 * embedding provider identity, live counts). Never exposes secrets.
 */
export const handleGetDiagnostics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getKnowledgeDiagnostics();
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};
