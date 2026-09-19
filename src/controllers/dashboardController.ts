/**
 * Phase 17 — dashboard aggregates (read-only, SQL counts only).
 *
 * Endpoints (mounted at /api/v1/dashboard):
 *   GET /qualification-mix  { total, hot, warm, cold } from qualifications.
 */
import { Request, Response, NextFunction } from 'express';
import { getQualificationMix } from '../services/dashboardService';

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
