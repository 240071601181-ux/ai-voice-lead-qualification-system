/**
 * Phase 12 – calendar booking status persistence.
 *
 * Pure persistence for meeting bookings. No provider knowledge,
 * no business rules, no HTTP: only SQL.
 */
import { pool } from '../database';

export type CalendarBookingStatus =
  | 'pending'
  | 'booked'
  | 'failed'
  | 'skipped_unavailable'
  | 'skipped_invalid_slot'
  | 'skipped_tier'
  | 'skipped_no_data';

export interface CalendarBookingRow {
  id: string;
  booking_key: string;
  lead_id: string | null;
  call_id: string | null;
  /** Phase 8: text-conversation anchor (NULL for legacy call bookings). */
  conversation_id: string | null;
  qualification_id: string | null;
  provider: string;
  calendar_id: string | null;
  external_event_id: string | null;
  meet_url: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  timezone: string | null;
  status: CalendarBookingStatus;
  attempts: number;
  slot_hash: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarBookingAttemptInput {
  booking_key: string;
  lead_id?: string | null;
  call_id?: string | null;
  /** Phase 8: text-conversation anchor (never a fabricated callId). */
  conversation_id?: string | null;
  qualification_id?: string | null;
  provider: string;
  calendar_id?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  timezone?: string | null;
  slot_hash: string;
}

export const findBookingById = async (id: string): Promise<CalendarBookingRow | null> => {
  const result = await pool.query('SELECT * FROM calendar_bookings WHERE id = $1', [id]);
  return result.rows[0] || null;
};

export const findBookingByKey = async (bookingKey: string): Promise<CalendarBookingRow | null> => {
  const result = await pool.query('SELECT * FROM calendar_bookings WHERE booking_key = $1', [
    bookingKey
  ]);
  return result.rows[0] || null;
};

/** Phase 8: bookings belonging to a text conversation, newest first. */
export const findBookingsByConversationId = async (
  conversationId: string
): Promise<CalendarBookingRow[]> => {
  const result = await pool.query(
    'SELECT * FROM calendar_bookings WHERE conversation_id = $1 ORDER BY created_at DESC',
    [conversationId]
  );
  return result.rows;
};

export const upsertBookingAttempt = async (
  input: CalendarBookingAttemptInput
): Promise<CalendarBookingRow> => {
  const result = await pool.query(
    `INSERT INTO calendar_bookings (booking_key, lead_id, call_id, conversation_id, qualification_id, provider, calendar_id,
                                    scheduled_start, scheduled_end, timezone, status, attempts, slot_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', 1, $11)
     ON CONFLICT (booking_key) DO UPDATE SET
       status = 'pending',
       attempts = calendar_bookings.attempts + 1,
       slot_hash = EXCLUDED.slot_hash,
       scheduled_start = EXCLUDED.scheduled_start,
       scheduled_end = EXCLUDED.scheduled_end,
       timezone = EXCLUDED.timezone,
       conversation_id = COALESCE(EXCLUDED.conversation_id, calendar_bookings.conversation_id),
       updated_at = NOW()
     RETURNING *`,
    [
      input.booking_key,
      input.lead_id || null,
      input.call_id || null,
      input.conversation_id || null,
      input.qualification_id || null,
      input.provider,
      input.calendar_id || null,
      input.scheduled_start || null,
      input.scheduled_end || null,
      input.timezone || null,
      input.slot_hash
    ]
  );
  return result.rows[0];
};

export const markBookingBooked = async (
  id: string,
  externalEventId: string,
  meetUrl: string | null
): Promise<CalendarBookingRow> => {
  const result = await pool.query(
    `UPDATE calendar_bookings
     SET status = 'booked', external_event_id = $2, meet_url = $3, last_error = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, externalEventId, meetUrl]
  );
  return result.rows[0];
};

export const markBookingSkipped = async (
  id: string,
  status: Extract<
    CalendarBookingStatus,
    'skipped_unavailable' | 'skipped_invalid_slot' | 'skipped_tier' | 'skipped_no_data'
  >
): Promise<CalendarBookingRow> => {
  const result = await pool.query(
    `UPDATE calendar_bookings SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return result.rows[0];
};

export const markBookingFailed = async (
  id: string,
  lastError: string
): Promise<CalendarBookingRow> => {
  const result = await pool.query(
    `UPDATE calendar_bookings SET status = 'failed', last_error = $2, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, lastError]
  );
  return result.rows[0];
};

export interface CalendarBookingListItem {
  id: string;
  lead_id: string | null;
  call_id: string | null;
  conversation_id: string | null;
  provider: string;
  external_event_id: string | null;
  meet_url: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  timezone: string | null;
  status: CalendarBookingStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Paginated booking inventory (newest first). Powers
 * GET /api/v1/calendar/bookings — the Calendar page table renders these
 * real rows verbatim (no demo meetings). Meet URLs / event ids render only
 * when the provider actually returned them.
 */
export const listBookings = async (args: { limit: number; offset: number }): Promise<CalendarBookingListItem[]> => {
  const res = await pool.query(
    `SELECT id, lead_id, call_id, conversation_id, provider, external_event_id, meet_url,
            scheduled_start, scheduled_end, timezone, status, created_at, updated_at
       FROM calendar_bookings
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    [args.limit, args.offset]
  );
  return res.rows;
};

export const countBookings = async (): Promise<number> => {
  const res = await pool.query('SELECT COUNT(*)::int AS count FROM calendar_bookings');
  return res.rows[0]?.count ?? 0;
};

export const countFailedBookings = async (): Promise<number> => {
  const res = await pool.query(`SELECT COUNT(*)::int AS count FROM calendar_bookings WHERE status = 'failed'`);
  return res.rows[0]?.count ?? 0;
};
