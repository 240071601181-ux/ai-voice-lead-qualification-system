/**
 * Phase 15 — aggregate agent-health metrics (real PostgreSQL aggregation).
 *
 * Endpoint (mounted at /api/v1/agent):
 *   GET /health-metrics  SQL counts/averages only; never message bodies.
 */
import { Request, Response, NextFunction } from 'express';
import { getAgentHealthMetrics } from '../services/agentHealthService';

export const getAgentHealthMetricsHandler = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const metrics = await getAgentHealthMetrics();
    return res.json({ success: true, data: metrics });
  } catch (err) {
    return next(err);
  }
};
