/**
 * CRM controller — thin HTTP mapping only.
 *
 * Endpoints (mounted at /api/v1/crm):
 *   GET  /diagnostics  real config/database/history checks (no secrets)
 *   POST /sync         explicit operator sync for one lead/call (real
 *                      orchestrator path, bounded, persisted)
 *   GET  /syncs        recent sync attempts (bounded, real rows)
 */
import { Request, Response, NextFunction } from 'express';
import {
  getCrmDiagnostics,
  listCrmSyncHistory,
  runCrmSyncNow
} from '../services/crm/crmDiagnosticsService';

export const getDiagnostics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ success: true, data: await getCrmDiagnostics() });
  } catch (err) {
    next(err);
  }
};

export const runSync = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runCrmSyncNow({
      leadId: req.body?.leadId,
      callId: req.body?.callId
    });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    if (typeof err.status === 'number') {
      return res.status(err.status).json({
        success: false,
        error: { message: err.message, code: err.status }
      });
    }
    next(err);
  }
};

export const listSyncs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.query.limit;
    const limit = raw === undefined ? 10 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return res.status(400).json({
        success: false,
        error: { message: 'limit must be an integer between 1 and 50', code: 400 }
      });
    }
    return res.json({ success: true, data: await listCrmSyncHistory(limit) });
  } catch (err) {
    next(err);
  }
};
