import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { pool } from '../database';
import {
  createConversation,
  endConversation,
  findConversationById,
  listConversationsByLeadId,
  updateConversationStatus,
} from '../repositories/conversationRepository';
import {
  countMessagesByConversationId,
  createMessage,
  listMessagesByConversationId,
  listRecentMessages,
} from '../repositories/conversationMessageRepository';
import {
  createConversationState,
  findConversationStateByConversationId,
  updateConversationStateRecord,
} from '../repositories/conversationStatesRepository';
import { ConversationService } from '../services/conversationService';
import { ConversationMessageService } from '../services/conversationMessageService';
import { getStateByCallId } from '../services/conversationStateService';

jest.mock('../database', () => {
  const mPool = {
    query: jest.fn(),
  };
  return { pool: mPool, default: mPool };
});

describe('Phase 2: Text Conversation Persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('conversation repository', () => {
    it('should create a web conversation defaulting to active', async () => {
      const row = { id: 'conv-1', lead_id: null, channel: 'web', status: 'active' };
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [row] });

      const created = await createConversation({ channel: 'web' });
      expect(created).toEqual(row);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO conversations'),
        [null, 'web', 'active', null]
      );
    });

    it('should fetch by id and list by lead newest-first', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: 'conv-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'conv-2' }, { id: 'conv-1' }] });

      expect(await findConversationById('conv-1')).toEqual({ id: 'conv-1' });
      const list = await listConversationsByLeadId('lead-1');
      expect(list).toHaveLength(2);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        ['lead-1']
      );
    });

    it('should complete a conversation via updateStatus and end()', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: 'conv-1', status: 'completed' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'conv-2', status: 'completed' }] });

      const updated = await updateConversationStatus('conv-1', 'completed');
      expect(updated?.status).toBe('completed');
      const ended = await endConversation('conv-2');
      expect(ended?.status).toBe('completed');
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ended_at'), [
        'completed',
        'conv-2',
      ]);
    });

    it('should reject unknown channel and status values', async () => {
      await expect(createConversation({ channel: 'voice' as any })).rejects.toThrow(
        'channel must be one of'
      );
      await expect(updateConversationStatus('conv-1', 'ended' as any)).rejects.toThrow(
        'status must be one of'
      );
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('message repository', () => {
    it('should append a user message', async () => {
      const row = { id: 'msg-1', conversation_id: 'conv-1', role: 'user', content: 'Hi' };
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [row] });

      const created = await createMessage({ conversation_id: 'conv-1', role: 'user', content: 'Hi' });
      expect(created).toEqual(row);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO conversation_messages'),
        ['conv-1', 'user', 'Hi', null, null]
      );
    });

    it('should retrieve history in chronological order', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
      await listMessagesByConversationId('conv-1');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at ASC, id ASC'),
        ['conv-1']
      );
    });

    it('should count and page recent messages', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ total: '3' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'm3' }] });
      expect(await countMessagesByConversationId('conv-1')).toBe(3);
      const recent = await listRecentMessages('conv-1', 5);
      expect(recent).toEqual([{ id: 'm3' }]);
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $2'), ['conv-1', 5]);
    });

    it('should reject invalid roles and empty content', async () => {
      await expect(
        createMessage({ conversation_id: 'conv-1', role: 'audio' as any, content: 'x' })
      ).rejects.toThrow('role must be one of');
      await expect(
        createMessage({ conversation_id: 'conv-1', role: 'user', content: '   ' })
      ).rejects.toThrow('content is required');
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('conversation state repository', () => {
    it('should create state idempotently', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] }) // no existing
        .mockResolvedValueOnce({ rows: [{ id: 'st-1', conversation_id: 'conv-1' }] });

      const created = await createConversationState({ conversation_id: 'conv-1', lead_id: 'lead-1' });
      expect(created.conversation_id).toBe('conv-1');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (conversation_id) DO NOTHING'),
        ['conv-1', 'lead-1']
      );
    });

    it('should update whitelisted slot columns', async () => {
      const updated = { id: 'st-1', conversation_id: 'conv-1', pickup_location: 'Chennai', budget: 15000 };
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [updated] });

      const result = await updateConversationStateRecord('conv-1', {
        pickup_location: 'Chennai',
        budget: 15000,
      });
      expect(result).toEqual(updated);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE conversation_states SET'),
        expect.arrayContaining(['Chennai', 15000, 'conv-1'])
      );
    });

    it('should look up state by conversationId', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'st-1' }] });
      expect(await findConversationStateByConversationId('conv-1')).toEqual({ id: 'st-1' });
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM conversation_states WHERE conversation_id = $1',
        ['conv-1']
      );
    });
  });

  describe('services (no LLM logic)', () => {
    it('ConversationService should default channel to web and end as completed', async () => {
      const svc = new ConversationService();
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: 'conv-1', channel: 'web', status: 'active' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'conv-1', status: 'completed' }] });

      const created = await svc.createConversation({ leadId: 'lead-1' });
      expect(created.channel).toBe('web');
      const ended = await svc.endConversation('conv-1');
      expect(ended?.status).toBe('completed');
    });

    it('ConversationService should validate ids', async () => {
      const svc = new ConversationService();
      await expect(svc.getConversation('' as any)).rejects.toThrow('id is required');
      await expect(svc.listByLead(null as any)).rejects.toThrow('leadId is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('ConversationMessageService should append and read history', async () => {
      const svc = new ConversationMessageService();
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: 'm1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'm1' }, { id: 'm2' }] })
        .mockResolvedValueOnce({ rows: [{ total: '2' }] });

      await svc.appendMessage({ conversationId: 'conv-1', role: 'user', content: 'Hello' });
      expect(await svc.getHistory('conv-1')).toHaveLength(2);
      expect(await svc.count('conv-1')).toBe(2);
    });

    it('legacy getStateByCallId should keep hitting the old table', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 's1', call_id: 'call-1' }] });
      const state = await getStateByCallId('call-1');
      expect(state).toEqual({ id: 's1', call_id: 'call-1' });
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM conversation_state WHERE call_id = $1',
        ['call-1']
      );
    });
  });

  describe('migration 014 contents', () => {
    const migrationsDir = path.resolve(__dirname, '..', 'database', 'migrations');
    const sql014 = readFileSync(path.join(migrationsDir, '014_create_text_conversation_tables.sql'), 'utf-8');

    it('should keep the sequence additive (014 through 017)', () => {
      const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
      expect(files).toHaveLength(17);
      expect(files[files.length - 4]).toBe('014_create_text_conversation_tables.sql');
      expect(files[files.length - 3]).toBe('015_conversation_qualification.sql');
      expect(files[files.length - 2]).toBe('016_conversation_calendar_bookings.sql');
      expect(files[files.length - 1]).toBe('017_user_auth_and_conversation_ownership.sql');
      expect(files.map((f) => f.slice(0, 3))).toEqual(
        Array.from({ length: 17 }, (_, i) => String(i + 1).padStart(3, '0'))
      );
    });

    it('should create the three text tables with checks and indexes', () => {
      expect(sql014).toMatch(/CREATE TABLE IF NOT EXISTS conversations \(/);
      expect(sql014).toMatch(/CREATE TABLE IF NOT EXISTS conversation_messages \(/);
      expect(sql014).toMatch(/CREATE TABLE IF NOT EXISTS conversation_states \(/);
      expect(sql014).toMatch(/channel IN \('web', 'whatsapp', 'legacy_voice'\)/);
      expect(sql014).toMatch(/status IN \('active', 'completed', 'abandoned'\)/);
      expect(sql014).toMatch(/role IN \('system', 'user', 'assistant', 'tool'\)/);
      expect(sql014).toMatch(/conversations_lead_id_idx/);
      expect(sql014).toMatch(/conversations_status_idx/);
      expect(sql014).toMatch(/conversations_created_at_idx/);
      expect(sql014).toMatch(/conversation_messages_conversation_created_idx/);
      expect(sql014).toMatch(/qualifications_conversation_id_idx/);
      expect(sql014).toMatch(/ADD COLUMN IF NOT EXISTS conversation_id/);
    });

    it('should not touch or drop legacy structures', () => {
      expect(sql014).not.toMatch(/DROP TABLE/i);
      expect(sql014).not.toMatch(/ALTER TABLE calls/i);
      expect(sql014).not.toMatch(/ALTER TABLE conversation_state/i);
      expect(sql014).not.toMatch(/DROP COLUMN/i);
    });
  });

  describe('migration 015 contents (Phase 6)', () => {
    const migrationsDir = path.resolve(__dirname, '..', 'database', 'migrations');
    const sql015 = readFileSync(path.join(migrationsDir, '015_conversation_qualification.sql'), 'utf-8');

    it('should enable conversation-anchored qualifications additively', () => {
      expect(sql015).toMatch(/ALTER TABLE qualifications/);
      expect(sql015).toMatch(/DROP NOT NULL/);
      expect(sql015).toMatch(/qualifications_conversation_id_unique_idx/);
    });

    it('should not touch or drop legacy structures', () => {
      expect(sql015).not.toMatch(/DROP TABLE/i);
      expect(sql015).not.toMatch(/ALTER TABLE calls/i);
      expect(sql015).not.toMatch(/ALTER TABLE conversation_state[^s]/i);
      expect(sql015).not.toMatch(/DROP COLUMN/i);
    });
  });

    describe('migration 016 contents (Phase 8)', () => {
    const migrationsDir = path.resolve(__dirname, '..', 'database', 'migrations');
    const sql016 = readFileSync(path.join(migrationsDir, '016_conversation_calendar_bookings.sql'), 'utf-8');
    it('should anchor conversation bookings additively', () => {
      expect(sql016).toMatch(/ALTER TABLE calendar_bookings/);
      expect(sql016).toMatch(/ADD COLUMN IF NOT EXISTS conversation_id/);
      expect(sql016).toMatch(/calendar_bookings_conversation_id_idx/);
    });

    it('should not touch or drop legacy structures', () => {
      expect(sql016).not.toMatch(/DROP TABLE/i);
      expect(sql016).not.toMatch(/ALTER TABLE calls/i);
      expect(sql016).not.toMatch(/ALTER TABLE conversation_state/i);
      expect(sql016).not.toMatch(/DROP COLUMN/i);
    });
  });

  describe('migration 017 contents (Phase 11)', () => {
    const migrationsDir = path.resolve(__dirname, '..', 'database', 'migrations');
    const sql017 = readFileSync(path.join(migrationsDir, '017_user_auth_and_conversation_ownership.sql'), 'utf-8');

    it('should create users/sessions and anchor conversation ownership additively', () => {
      expect(sql017).toMatch(/CREATE TABLE IF NOT EXISTS users \(/);
      expect(sql017).toMatch(/password_hash/);
      expect(sql017).toMatch(/CREATE TABLE IF NOT EXISTS user_sessions \(/);
      expect(sql017).toMatch(/ADD COLUMN IF NOT EXISTS user_id/);
      expect(sql017).toMatch(/conversations_user_id_idx/);
    });

    it('should not touch or drop legacy structures', () => {
      expect(sql017).not.toMatch(/DROP TABLE/i);
      expect(sql017).not.toMatch(/ALTER TABLE calls/i);
      expect(sql017).not.toMatch(/ALTER TABLE conversation_state/i);
      expect(sql017).not.toMatch(/DROP COLUMN/i);
    });
  });
});
