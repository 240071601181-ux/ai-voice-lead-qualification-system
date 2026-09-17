import { pool } from '../database';
import { Conversation } from '../models/Conversation';
import { ConversationChannel, ConversationStatus, CONVERSATION_CHANNELS, CONVERSATION_STATUSES } from '../agent/conversation';

export interface CreateConversationInput {
  lead_id?: string | null;
  channel: ConversationChannel;
  status?: ConversationStatus;
}

export const validateChannel = (channel: unknown): string[] =>
  typeof channel === 'string' && (CONVERSATION_CHANNELS as string[]).includes(channel)
    ? []
    : [`channel must be one of: ${CONVERSATION_CHANNELS.join(', ')}`];

export const validateStatus = (status: unknown): string[] =>
  typeof status === 'string' && (CONVERSATION_STATUSES as string[]).includes(status)
    ? []
    : [`status must be one of: ${CONVERSATION_STATUSES.join(', ')}`];

export const createConversation = async (input: CreateConversationInput): Promise<Conversation> => {
  const channelErrors = validateChannel(input.channel);
  if (channelErrors.length > 0) {
    throw new Error(channelErrors.join('; '));
  }
  const status = input.status ?? 'active';
  const statusErrors = validateStatus(status);
  if (statusErrors.length > 0) {
    throw new Error(statusErrors.join('; '));
  }
  const res = await pool.query(
    `INSERT INTO conversations (lead_id, channel, status, started_at)
     VALUES ($1, $2, $3, NOW()) RETURNING *`,
    [input.lead_id || null, input.channel, status]
  );
  return res.rows[0];
};

export const findConversationById = async (id: string): Promise<Conversation | null> => {
  const res = await pool.query('SELECT * FROM conversations WHERE id = $1', [id]);
  return res.rows[0] || null;
};

export const listConversationsByLeadId = async (leadId: string): Promise<Conversation[]> => {
  const res = await pool.query(
    'SELECT * FROM conversations WHERE lead_id = $1 ORDER BY created_at DESC',
    [leadId]
  );
  return res.rows;
};

export interface ListConversationsFilter {
  leadId?: string;
  status?: ConversationStatus;
  channel?: ConversationChannel;
  limit: number;
  offset: number;
}

/** Filtered, paginated list with deterministic newest-first ordering. */
export const listConversations = async (filter: ListConversationsFilter): Promise<Conversation[]> => {
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (filter.leadId) {
    conditions.push(`lead_id = $${idx++}`);
    values.push(filter.leadId);
  }
  if (filter.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filter.status);
  }
  if (filter.channel) {
    conditions.push(`channel = $${idx++}`);
    values.push(filter.channel);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(filter.limit, filter.offset);
  const res = await pool.query(
    `SELECT * FROM conversations ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return res.rows;
};

export const countConversations = async (filter: Omit<ListConversationsFilter, 'limit' | 'offset'>): Promise<number> => {
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (filter.leadId) {
    conditions.push(`lead_id = $${idx++}`);
    values.push(filter.leadId);
  }
  if (filter.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filter.status);
  }
  if (filter.channel) {
    conditions.push(`channel = $${idx++}`);
    values.push(filter.channel);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await pool.query(`SELECT COUNT(*) AS total FROM conversations ${where}`, values);
  return Number(res.rows[0]?.total ?? 0);
};

export const updateConversationStatus = async (
  id: string,
  status: ConversationStatus
): Promise<Conversation | null> => {
  const statusErrors = validateStatus(status);
  if (statusErrors.length > 0) {
    throw new Error(statusErrors.join('; '));
  }
  const res = await pool.query(
    `UPDATE conversations
     SET status = $1,
         ended_at = CASE WHEN $1 IN ('completed', 'abandoned') THEN COALESCE(ended_at, NOW()) ELSE ended_at END
     WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return res.rows[0] || null;
};

export const endConversation = async (
  id: string,
  status: Extract<ConversationStatus, 'completed' | 'abandoned'> = 'completed'
): Promise<Conversation | null> => {
  const res = await pool.query(
    'UPDATE conversations SET status = $1, ended_at = COALESCE(ended_at, NOW()) WHERE id = $2 RETURNING *',
    [status, id]
  );
  return res.rows[0] || null;
};
