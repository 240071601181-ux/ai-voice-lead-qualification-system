/**
 * Calendar sync-state persistence.
 *
 * Single-row table (`calendar_sync_state`, id always 1) holding the latest
 * connectivity-check outcome. Pure persistence: no provider knowledge.
 */
import { pool } from '../database';

export type CalendarSyncStatus = 'success' | 'failed';

export interface CalendarSyncState {
  id: number;
  status: CalendarSyncStatus;
  last_sync_at: string;
  message: string | null;
  created_at: string;
  updated_at: string;
}

export const getCalendarSyncState = async (): Promise<CalendarSyncState | null> => {
  const result = await pool.query('SELECT * FROM calendar_sync_state WHERE id = 1');
  return result.rows[0] || null;
};

export const recordCalendarSyncRun = async (
  status: CalendarSyncStatus,
  message: string | null
): Promise<CalendarSyncState> => {
  const result = await pool.query(
    `INSERT INTO calendar_sync_state (id, status, last_sync_at, message, updated_at)
     VALUES (1, $1, NOW(), $2, NOW())
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       last_sync_at = NOW(),
       message = EXCLUDED.message,
       updated_at = NOW()
     RETURNING *`,
    [status, message]
  );
  return result.rows[0];
};
