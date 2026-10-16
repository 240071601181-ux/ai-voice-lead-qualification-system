import { pool } from '../database';

export interface QualificationMix {
  total: number;
  hot: number;
  warm: number;
  cold: number;
}

const toInt = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
};

/**
 * Phase 17 — real qualification-mix aggregates for the dashboard donut.
 *
 * Counts persisted qualification records by tier (single GROUP BY query —
 * no row fetching). Tiers outside HOT/WARM/COLD are ignored so only the
 * deterministic scorer's outputs shape the chart. Scoring untouched.
 */
export const getQualificationMix = async (): Promise<QualificationMix> => {
  const res = await pool.query(
    'SELECT tier, COUNT(*)::int AS n FROM qualifications GROUP BY tier'
  );
  const mix: QualificationMix = { total: 0, hot: 0, warm: 0, cold: 0 };
  for (const row of res.rows as Array<{ tier: string; n: number }>) {
    const n = toInt(row.n);
    if (row.tier === 'HOT') mix.hot = n;
    else if (row.tier === 'WARM') mix.warm = n;
    else if (row.tier === 'COLD') mix.cold = n;
    else continue;
    mix.total += n;
  }
  return mix;
};

export interface DashboardSummary {
  leads: { total: number };
  qualifications: QualificationMix;
  /** Ownership-scoped to the requesting user (mirrors the conversations list). */
  conversations: { total: number; active: number; completed: number; abandoned: number };
  followups: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  bookings: { total: number; upcoming: number };
}

/**
 * Phase 4 — dashboard summary aggregates (read-only, SQL counts only).
 *
 * One bounded GROUP BY / COUNT per table — no row fetching. Conversations
 * are scoped to the requesting user (`user_id = $1`), exactly like the
 * conversations list endpoint; every other table is shared workspace data
 * visible to both ADMIN and USER (same rule as the underlying list
 * endpoints). Unknown status values are ignored so only known states shape
 * the counts.
 */
export const getDashboardSummary = async (userId: string): Promise<DashboardSummary> => {
  const [leadRes, convRes, followupRes, bookingRes, upcomingRes, mix] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS n FROM leads'),
    pool.query('SELECT status, COUNT(*)::int AS n FROM conversations WHERE user_id = $1 GROUP BY status', [
      userId,
    ]),
    pool.query('SELECT status, COUNT(*)::int AS n FROM follow_ups GROUP BY status'),
    pool.query('SELECT COUNT(*)::int AS n FROM calendar_bookings'),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM calendar_bookings
        WHERE scheduled_start IS NOT NULL AND scheduled_start > NOW()
          AND status IN ('pending', 'booked')`
    ),
    getQualificationMix(),
  ]);

  const conversations = { total: 0, active: 0, completed: 0, abandoned: 0 };
  for (const row of convRes.rows as Array<{ status: string; n: number }>) {
    const n = toInt(row.n);
    if (row.status === 'active') conversations.active = n;
    else if (row.status === 'completed') conversations.completed = n;
    else if (row.status === 'abandoned') conversations.abandoned = n;
    else continue;
    conversations.total += n;
  }

  const followups = { total: 0, pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const row of followupRes.rows as Array<{ status: string; n: number }>) {
    const n = toInt(row.n);
    if (row.status === 'pending') followups.pending = n;
    else if (row.status === 'processing') followups.processing = n;
    else if (row.status === 'completed') followups.completed = n;
    else if (row.status === 'failed') followups.failed = n;
    else if (row.status === 'cancelled') followups.cancelled = n;
    else continue;
    followups.total += n;
  }

  return {
    leads: { total: toInt(leadRes.rows[0]?.n) },
    qualifications: mix,
    conversations,
    followups,
    bookings: {
      total: toInt(bookingRes.rows[0]?.n),
      upcoming: toInt(upcomingRes.rows[0]?.n),
    },
  };
};
