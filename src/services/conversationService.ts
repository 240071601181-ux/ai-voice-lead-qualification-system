import { Conversation } from '../models/Conversation';
import { ConversationChannel, ConversationStatus } from '../agent/conversation';
import {
  createConversation as repoCreate,
  endConversation as repoEnd,
  findConversationById as repoFindById,
  listConversationsByLeadId as repoListByLead,
  updateConversationStatus as repoUpdateStatus,
} from '../repositories/conversationRepository';

export interface CreateConversationInput {
  leadId?: string | null;
  channel?: ConversationChannel;
}

export type EndConversationStatus = Extract<ConversationStatus, 'completed' | 'abandoned'>;

/**
 * Text-conversation lifecycle. Validation + repository calls + timestamps
 * only — no LLM logic lives here (that stays in AgentOrchestrator).
 */
export class ConversationService {
  async createConversation(input: CreateConversationInput = {}): Promise<Conversation> {
    return repoCreate({
      lead_id: input.leadId || null,
      channel: input.channel ?? 'web',
    });
  }

  async getConversation(id: string): Promise<Conversation | null> {
    if (!id || typeof id !== 'string') {
      throw new Error('id is required and must be a string');
    }
    return repoFindById(id);
  }

  async listByLead(leadId: string): Promise<Conversation[]> {
    if (!leadId || typeof leadId !== 'string') {
      throw new Error('leadId is required and must be a string');
    }
    return repoListByLead(leadId);
  }

  async updateStatus(id: string, status: ConversationStatus): Promise<Conversation | null> {
    if (!id || typeof id !== 'string') {
      throw new Error('id is required and must be a string');
    }
    return repoUpdateStatus(id, status);
  }

  async endConversation(id: string, status: EndConversationStatus = 'completed'): Promise<Conversation | null> {
    if (!id || typeof id !== 'string') {
      throw new Error('id is required and must be a string');
    }
    return repoEnd(id, status);
  }
}

export const conversationService = new ConversationService();
