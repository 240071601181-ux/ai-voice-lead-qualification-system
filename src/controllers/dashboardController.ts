/**
 * Phase 17 — dashboard aggregates (read-only, SQL counts only).
 *
 * Endpoints (mounted at /api/v1/dashboard):
 *   GET /qualification-mix  { total, hot, warm, cold } from qualifications.
 *   GET /summary  Phase 4 — bounded counts for the dashboard cards. No row
 *     fetching; conversations are scoped to the requesting user.
 */
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/requireAuth';
import { getDashboardSummary, getQualificationMix } from '../services/dashboardService';

export const getQualificationMixHandler = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const mix = await getQualificationMix();
    return res.json({ success: true, data: mix });
  } catch (err) {
    return next(err);
  }
};

export const getDashboardSummaryHandler = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user?.id) {
      return res
        .status(401)
        .json({ success: false, error: { message: 'Authentication required', code: 401 } });
    }
    const summary = await getDashboardSummary(req.user.id);
    return res.json({ success: true, data: summary });
  } catch (err) {
    return next(err);
  }
};
