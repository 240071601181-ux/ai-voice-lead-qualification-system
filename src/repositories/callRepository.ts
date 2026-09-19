import { pool } from '../database';
import { Call } from '../models/Call';

/**
 * Phase 14 — legacy voice/Vapi retired. The `calls` table is NOT dropped
 * (historical rows preserved), but the voice write path (upsert,
 * find-by-Vapi-id, active-call guard) is removed with the voice services.
 * This read stays as the minimum compatibility layer: shared text services
 * (qualification, CRM, follow-ups, n8n, WhatsApp, calendar) optionally
 * enrich by call id when a legacy call-anchored record is involved
 * (`callId ? findCallById(callId) : null`).
 */
export const findCallById = async (id: string): Promise<Call | null> => {
  const res = await pool.query('SELECT * FROM calls WHERE id = $1', [id]);
  return res.rows[0] || null;
};
