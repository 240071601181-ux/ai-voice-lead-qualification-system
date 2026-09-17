/**
 * WhatsApp controller — thin HTTP mapping only.
 *
 * Endpoints (mounted at /api/v1/whatsapp):
 *   GET /diagnostics  real config/database/history checks (no secrets,
 *                     template names only, consent mode reported)
 *   GET /deliveries   recent delivery attempts (bounded, real rows)
 *
 * There is deliberately NO send endpoint: sends are event-driven and
 * consent-gated server-side; the browser never sends messages.
 */
import { Request, Response, NextFunction } from 'express';
import {
  getWhatsappDiagnostics,
  listWhatsappDeliveryHistory
} from '../services/whatsapp/whatsappDiagnosticsService';

export const getDiagnostics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ success: true, data: await getWhatsappDiagnostics() });
  } catch (err) {
    next(err);
  }
};

export const listDeliveries = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.query.limit;
    const limit = raw === undefined ? 10 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return res.status(400).json({
        success: false,
        error: { message: 'limit must be an integer between 1 and 50', code: 400 }
      });
    }
    return res.json({ success: true, data: await listWhatsappDeliveryHistory(limit) });
  } catch (err) {
    next(err);
  }
};
