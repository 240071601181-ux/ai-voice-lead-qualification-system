import { pool } from '../database';
import { orchestrator } from '../agent/orchestrator';
import {
  AgentContext,
  CHANNEL_METADATA,
  CONVERSATION_CHANNELS,
  CONVERSATION_STATUSES,
  isConversationChannel,
  isConversationStatus,
  resolveAgentIdentity,
  validateAgentContext,
} from '../agent/conversation';
import { textConversationDefaults, agentConfig } from '../agent/config';
import {
  getStateByCallId,
  getStateByConversationId,
} from '../services/conversationStateService';

jest.mock('../database', () => {
  const mPool = {
    query: jest.fn(),
  };
  return { pool: mPool, default: mPool };
});

describe('Phase 1: Text Conversation Architecture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('channel + status vocabulary', () => {
    it('should accept web, whatsapp, and legacy_voice channels', () => {
      expect(CONVERSATION_CHANNELS).toEqual(['web', 'whatsapp', 'legacy_voice']);
      expect(isConversationChannel('web')).toBe(true);
      expect(isConversationChannel('whatsapp')).toBe(true);
      expect(isConversationChannel('legacy_voice')).toBe(true);
      expect(isConversationChannel('voice')).toBe(false);
      expect(isConversationChannel('vapi')).toBe(false);
      expect(isConversationChannel(undefined)).toBe(false);
    });

    it('should accept active, completed, and abandoned statuses', () => {
      expect(CONVERSATION_STATUSES).toEqual(['active', 'completed', 'abandoned']);
      expect(isConversationStatus('active')).toBe(true);
      expect(isConversationStatus('completed')).toBe(true);
      expect(isConversationStatus('abandoned')).toBe(true);
      expect(isConversationStatus('ended')).toBe(false);
      expect(isConversationStatus('initiated')).toBe(false);
    });

    it('should mark only legacy_voice as the legacy compatibility channel', () => {
      expect(CHANNEL_METADATA.web.isLegacy).toBe(false);
      expect(CHANNEL_METADATA.whatsapp.isLegacy).toBe(false);
      expect(CHANNEL_METADATA.legacy_voice.isLegacy).toBe(true);
    });
  });

  describe('validateAgentContext', () => {
    it('should accept a conversation-first context', () => {
      const context: AgentContext = { conversationId: 'conv-1', leadId: 'lead-1', channel: 'web' };
      expect(validateAgentContext(context)).toEqual([]);
    });

    it('should accept a legacy call context', () => {
      expect(validateAgentContext({ callId: 'call-1' })).toEqual([]);
    });

    it('should reject a context with neither identity', () => {
      expect(validateAgentContext({})).toEqual(['Either conversationId or callId is required']);
      expect(validateAgentContext(null)).toEqual(['Context must be an object']);
    });

    it('should reject unknown channels and non-string ids', () => {
      const errors = validateAgentContext({ conversationId: 'conv-1', channel: 'voice' });
      expect(errors).toEqual(['channel must be one of: web, whatsapp, legacy_voice']);
      expect(validateAgentContext({ conversationId: 123 as any })).toContain('conversationId must be a string');
      expect(validateAgentContext({ callId: 123 as any })).toContain('callId must be a string');
    });
  });

  describe('resolveAgentIdentity', () => {
    it('should prefer conversationId when both identities are present', () => {
      expect(resolveAgentIdentity({ conversationId: 'conv-1', callId: 'call-1' })).toEqual({
        kind: 'conversation',
        conversationId: 'conv-1',
      });
    });

    it('should fall back to callId for legacy voice', () => {
      expect(resolveAgentIdentity({ callId: 'call-1' })).toEqual({ kind: 'call', callId: 'call-1' });
    });

    it('should resolve none when no identity is provided', () => {
      expect(resolveAgentIdentity({})).toEqual({ kind: 'none' });
    });
  });

  describe('state lookup abstraction', () => {
    it('should keep the legacy call lookup working', async () => {
      const legacyState = { id: 's1', call_id: 'call-1', pickup_location: 'Chennai' };
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [legacyState] });

      const state = await getStateByCallId('call-1');
      expect(state).toEqual(legacyState);
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM conversation_state WHERE call_id = $1',
        ['call-1']
      );
    });

    it('should return null for unlinked conversationIds without touching call tables', async () => {
      const state = await getStateByConversationId('conv-new');
      expect(state).toBeNull();
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('should resolve linked legacy calls through the existing lookup', async () => {
      const legacyState = { id: 's1', call_id: 'call-9', pickup_location: 'Chennai' };
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [legacyState] });

      const state = await getStateByConversationId('conv-legacy', { linkedCallId: 'call-9' });
      expect(state).toEqual(legacyState);
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM conversation_state WHERE call_id = $1',
        ['call-9']
      );
    });
  });

  describe('orchestrator dual identity', () => {
    it('should process a conversation turn without requiring call state', async () => {
      const response = await orchestrator.processTurn({
        conversationId: 'conv-1',
        channel: 'web',
        messages: [{ role: 'user', content: 'Hello, I need to ship cargo' }],
      });

      expect(response.content).toBeDefined();
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('should keep loading legacy call state on the call path', async () => {
      const mockState = {
        id: 'state-123',
        call_id: 'call-123',
        customer_name: 'John Doe',
        pickup_location: 'Chennai',
        destination: 'Bengaluru',
        cargo_weight: 500,
      };
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockState] });

      const response = await orchestrator.processTurn({
        callId: 'call-123',
        messages: [{ role: 'user', content: 'Where is my pickup?' }],
      });

      expect(response.content).toBeDefined();
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM conversation_state WHERE call_id = $1',
        ['call-123']
      );
    });

    it('should accept the reusable AgentContext object', async () => {
      const response = await orchestrator.processTurn({
        context: { conversationId: 'conv-ctx', leadId: 'lead-1', channel: 'whatsapp' },
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(response.content).toBeDefined();
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('should remain stateless when no identity is provided', async () => {
      const response = await orchestrator.processTurn({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(response.content).toBeDefined();
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('text conversation defaults', () => {
    it('should default new conversations to web within the core turn budget', () => {
      expect(textConversationDefaults.defaultChannel).toBe('web');
      expect(textConversationDefaults.maxTurns).toBe(agentConfig.conversationRules.maxTurns);
    });
  });
});
