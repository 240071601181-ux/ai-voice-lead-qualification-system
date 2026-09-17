import { pool } from '../database';
import { ConversationMessage, ConversationMessageRole, CONVERSATION_MESSAGE_ROLES } from '../models/Conversation';

export interface CreateMessageInput {
  conversation_id: string;
  role: ConversationMessageRole;
  content: string;
  metadata?: Record<string, unknown> | null;
  tool_calls?: unknown | null;
}

export const createMessage = async (input: CreateMessageInput): Promise<ConversationMessage> => {
  if (!input.conversation_id || typeof input.conversation_id !== 'string') {
    throw new Error('conversation_id is required and must be a string');
  }
  if (!CONVERSATION_MESSAGE_ROLES.includes(input.role)) {
    throw new Error(`role must be one of: ${CONVERSATION_MESSAGE_ROLES.join(', ')}`);
  }
  if (!input.content || typeof input.content !== 'string' || input.content.trim().length === 0) {
    throw new Error('content is required and must be a non-empty string');
  }
  const res = await pool.query(
    `INSERT INTO conversation_messages (conversation_id, role, content, metadata, tool_calls)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      input.conversation_id,
      input.role,
      input.content,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.tool_calls !== undefined && input.tool_calls !== null
        ? (typeof input.tool_calls === 'string' ? input.tool_calls : JSON.stringify(input.tool_calls))
        : null,
    ]
  );
  return res.rows[0];
};

/** Chronological history for prompt assembly and transcript views. */
export const listMessagesByConversationId = async (
  conversationId: string
): Promise<ConversationMessage[]> => {
  const res = await pool.query(
    `SELECT * FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC, id ASC`,
    [conversationId]
  );
  return res.rows;
};

/** Chronological page for history endpoints. */
export const listMessagesPage = async (
  conversationId: string,
  limit: number,
  offset: number
): Promise<ConversationMessage[]> => {
  const res = await pool.query(
    `SELECT * FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC, id ASC
     LIMIT $2 OFFSET $3`,
    [conversationId, limit, offset]
  );
  return res.rows;
};

export const countMessagesByConversationId = async (conversationId: string): Promise<number> => {
  const res = await pool.query(
    'SELECT COUNT(*) AS total FROM conversation_messages WHERE conversation_id = $1',
    [conversationId]
  );
  return Number(res.rows[0]?.total ?? 0);
};

/** Most recent N messages, returned in chronological order. */
export const listRecentMessages = async (
  conversationId: string,
  limit: number
): Promise<ConversationMessage[]> => {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
  const res = await pool.query(
    `SELECT * FROM (
       SELECT * FROM conversation_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2
     ) recent ORDER BY created_at ASC, id ASC`,
    [conversationId, safeLimit]
  );
  return res.rows;
};
