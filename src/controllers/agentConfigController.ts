/**
 * Agent configuration controller — thin HTTP mapping only.
 *
 * Endpoints (mounted at /api/v1/agent):
 *   GET   /config   current operator-visible agent configuration
 *   PATCH /config   update editable conversation behavior / paused flag
 *   POST  /pause    pause the agent
 *   POST  /resume   resume the agent
 *   GET   /health   honest agent status (no aggregate telemetry exists, so
 *                   metrics are explicitly null with a reason — never faked)
 *
 * Validation + state live in `agentConfigService`. No secrets or provider
 * keys are ever read or returned here (telephony is reported as a boolean).
 */
import { Request, Response, NextFunction } from 'express';
import {
  getAgentConfig,
  setAgentPaused,
  updateAgentConfig
} from '../services/agentConfigService';

export const getConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ success: true, data: getAgentConfig() });
  } catch (err) {
    next(err);
  }
};

export const patchConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ success: true, data: updateAgentConfig(req.body) });
  } catch (err) {
    next(err);
  }
};

export const pauseAgent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ success: true, data: setAgentPaused(true) });
  } catch (err) {
    next(err);
  }
};

export const resumeAgent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ success: true, data: setAgentPaused(false) });
  } catch (err) {
    next(err);
  }
};

/**
 * Honest agent health: real status flags only. No call-connection rate,
 * qualification rate, quality score, or latency telemetry is collected by
 * this backend, so metrics are null with an explicit reason instead of
 * demo values. (Phase 14: telephonyConfigured retired with Vapi.)
 */
export const getHealth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getAgentConfig();
    return res.json({
      success: true,
      data: {
        status: config.paused ? 'paused' : 'active',
        paused: config.paused,
        name: config.name,
        version: config.version,
        liveSession: false,
        metrics: null,
        metricsReason: 'No aggregate telemetry is collected. Connect a metrics provider to enable agent health metrics.'
      }
    });
  } catch (err) {
    next(err);
  }
};
