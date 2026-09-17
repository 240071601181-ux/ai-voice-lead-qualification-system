import { ConversationMessage, ConversationMessageRole } from '../models/Conversation';
import {
  countMessagesByConversationId as repoCount,
  createMessage as repoCreate,
  listMessagesByConversationId as repoList,
  listRecentMessages as repoRecent,
} from '../repositories/conversationMessageRepository';

export interface AppendMessageInput {
  conversationId: string;
  role: ConversationMessageRole;
  content: string;
  metadata?: Record<string, unknown> | null;
  toolCalls?: unknown | null;
}

/**
 * Message persistence. Validation + repository calls only — response
 * generation stays in AgentOrchestrator.
 */
export class ConversationMessageService {
  async appendMessage(input: AppendMessageInput): Promise<ConversationMessage> {
    return repoCreate({
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      metadata: input.metadata ?? null,
      tool_calls: input.toolCalls ?? null,
    });
  }

  async getHistory(conversationId: string): Promise<ConversationMessage[]> {
    if (!conversationId || typeof conversationId !== 'string') {
      throw new Error('conversationId is required and must be a string');
    }
    return repoList(conversationId);
  }

  async getRecent(conversationId: string, limit = 20): Promise<ConversationMessage[]> {
    if (!conversationId || typeof conversationId !== 'string') {
      throw new Error('conversationId is required and must be a string');
    }
    return repoRecent(conversationId, limit);
  }

  async count(conversationId: string): Promise<number> {
    if (!conversationId || typeof conversationId !== 'string') {
      throw new Error('conversationId is required and must be a string');
    }
    return repoCount(conversationId);
  }
}

export const conversationMessageService = new ConversationMessageService();
