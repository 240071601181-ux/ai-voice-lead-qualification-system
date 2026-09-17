/**
 * Settings controller — thin HTTP mapping only.
 *
 * Endpoints (mounted at /api/v1/settings):
 *   GET   /  current workspace settings (seeded defaults on first read)
 *   PATCH /  update editable workspace settings (validated server-side)
 *
 * Validation + persistence live in `settingsService`. No secrets are
 * stored or returned here (display preferences + boolean flags only).
 */
import { Request, Response, NextFunction } from 'express';
import { getSettings, updateSettings } from '../services/settingsService';

export const getWorkspaceSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ success: true, data: await getSettings() });
  } catch (err) {
    next(err);
  }
};

export const patchWorkspaceSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ success: true, data: await updateSettings(req.body) });
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
