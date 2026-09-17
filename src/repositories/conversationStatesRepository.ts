import { pool } from '../database';
import { ConversationStateRecord } from '../models/Conversation';

/**
 * Text-conversation slot state (table: conversation_states).
 * Function style mirrors repositories/conversationStateRepository.ts.
 * The legacy call-anchored repository is untouched.
 */
export const findConversationStateByConversationId = async (
  conversationId: string
): Promise<ConversationStateRecord | null> => {
  const res = await pool.query('SELECT * FROM conversation_states WHERE conversation_id = $1', [
    conversationId,
  ]);
  return res.rows[0] || null;
};

export const createConversationState = async (state: {
  conversation_id: string;
  lead_id?: string | null;
}): Promise<ConversationStateRecord> => {
  if (!state.conversation_id || typeof state.conversation_id !== 'string') {
    throw new Error('conversation_id is required and must be a string');
  }
  const existing = await findConversationStateByConversationId(state.conversation_id);
  if (existing) {
    return existing;
  }
  const res = await pool.query(
    `INSERT INTO conversation_states (conversation_id, lead_id)
     VALUES ($1, $2)
     ON CONFLICT (conversation_id) DO NOTHING RETURNING *`,
    [state.conversation_id, state.lead_id || null]
  );
  if (res.rows[0]) {
    return res.rows[0];
  }
  const fallback = await findConversationStateByConversationId(state.conversation_id);
  return fallback!;
};

const STATE_COLUMNS = [
  'lead_id',
  'customer_name',
  'pickup_location',
  'destination',
  'vehicle_type',
  'cargo_type',
  'cargo_weight',
  'cargo_dimensions',
  'required_date',
  'budget',
  'urgency',
  'booking_intent',
  'additional_requirements',
] as const;

export const updateConversationStateRecord = async (
  conversationId: string,
  updates: Partial<ConversationStateRecord>
): Promise<ConversationStateRecord | null> => {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  for (const column of STATE_COLUMNS) {
    if (updates[column] !== undefined) {
      fields.push(`${column} = $${idx++}`);
      values.push(updates[column]);
    }
  }
  if (fields.length === 0) {
    return findConversationStateByConversationId(conversationId);
  }
  const query = `UPDATE conversation_states SET ${fields.join(
    ', '
  )}, updated_at = NOW() WHERE conversation_id = $${idx} RETURNING *`;
  values.push(conversationId);
  const res = await pool.query(query, values);
  return res.rows[0] || null;
};
