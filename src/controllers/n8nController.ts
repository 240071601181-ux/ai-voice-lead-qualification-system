/**
 * n8n controller — thin HTTP mapping only.
 *
 * Endpoints (mounted at /api/v1/n8n):
 *   GET /diagnostics  real config/database/history checks (webhook URLs
 *                     and secrets never exposed)
 *   GET /workflows    configured workflows with real delivery stats
 *
 * There is deliberately NO emit/test endpoint: emitting would fire real
 * customer workflows from the browser.
 */
import { Request, Response, NextFunction } from 'express';
import { getN8nDiagnostics, listN8nWorkflows } from '../services/n8n/n8nDiagnosticsService';

export const getDiagnostics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ success: true, data: await getN8nDiagnostics() });
  } catch (err) {
    next(err);
  }
};

export const listWorkflows = async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ success: true, data: await listN8nWorkflows() });
  } catch (err) {
    next(err);
  }
};
