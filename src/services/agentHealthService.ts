import { pool } from '../database';

export interface AgentConversationTotals {
  total: number;
  active: number;
  completed: number;
  abandoned: number;
}

export interface AgentQualificationRate {
  qualifiedConversations: number;
  totalConversations: number;
  /** 0–100 with one decimal, or null when there is nothing to rate. */
  ratePercent: number | null;
}

export interface AgentResponsiveness {
  /** Mean seconds from first user message to first later assistant reply. */
  avgFirstResponseSec: number | null;
  conversationsMeasured: number;
}

export interface AgentHealthMetrics {
  textConversations: AgentConversationTotals;
  qualification: AgentQualificationRate;
  responsiveness: AgentResponsiveness;
  /**
   * Always null: no deterministic conversation-quality metric exists.
   * The UI must render "Not available", never a fabricated score.
   */
  quality: null;
  qualityReason: string;
}

const toInt = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
};

/**
 * Phase 15 — real aggregate agent-health metrics from PostgreSQL.
 *
 * All values come from bounded SQL aggregation (GROUP BY / single-pass
 * joins); message bodies are never loaded into Node. Qualification scoring
 * is untouched — this only counts persisted rows.
 */
export const getAgentHealthMetrics = async (): Promise<AgentHealthMetrics> => {
  const statusRows = await pool.query(
    'SELECT status, COUNT(*)::int AS n FROM conversations GROUP BY status'
  );
  const totals: AgentConversationTotals = { total: 0, active: 0, completed: 0, abandoned: 0 };
  for (const row of statusRows.rows as Array<{ status: string; n: number }>) {
    const n = toInt(row.n);
    totals.total += n;
    if (row.status === 'active') totals.active = n;
    else if (row.status === 'completed') totals.completed = n;
    else if (row.status === 'abandoned') totals.abandoned = n;
  }

  const qualRows = await pool.query(
    'SELECT COUNT(DISTINCT conversation_id)::int AS qualified FROM qualifications WHERE conversation_id IS NOT NULL'
  );
  const qualifiedConversations = toInt(qualRows.rows[0]?.qualified);
  const qualification: AgentQualificationRate = {
    qualifiedConversations,
    totalConversations: totals.total,
    ratePercent:
      totals.total > 0 ? Math.round((qualifiedConversations / totals.total) * 1000) / 10 : null,
  };

  // First user message → first later assistant reply, averaged. Conversations
  // without that pair are excluded from both the average and the count.
  const responseRows = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (a.created_at - u.first_user))) AS avg_sec,
            COUNT(*)::int AS n
     FROM (
       SELECT conversation_id, MIN(created_at) AS first_user
       FROM conversation_messages
       WHERE role = 'user'
       GROUP BY conversation_id
     ) u
     JOIN LATERAL (
       SELECT created_at
       FROM conversation_messages
       WHERE conversation_id = u.conversation_id
         AND role = 'assistant'
         AND created_at > u.first_user
       ORDER BY created_at ASC
       LIMIT 1
     ) a ON true`
  );
  const avgRaw = responseRows.rows[0]?.avg_sec;
  const avgNum = avgRaw === null || avgRaw === undefined ? NaN : Number(avgRaw);
  const responsiveness: AgentResponsiveness = {
    avgFirstResponseSec: Number.isFinite(avgNum) ? Math.round(avgNum * 10) / 10 : null,
    conversationsMeasured: toInt(responseRows.rows[0]?.n),
  };

  return {
    textConversations: totals,
    qualification,
    responsiveness,
    quality: null,
    qualityReason: 'No deterministic conversation-quality metric exists.',
  };
};
