import { NextFunction, Response } from 'express';
import { ChatAuthRequest } from '../middleware/conversationAuth';
import { isConversationChannel, isConversationStatus } from '../agent/conversation';
import {
  ConversationMessage,
} from '../models/Conversation';
import { LlmMessage } from '../agent/llm';
import { orchestrator } from '../agent/orchestrator';
import { getChatMaxContextMessages, getChatMaxMessageLength } from '../config';
import { extractAndPersistTextState } from '../services/conversationStateService';
import {
  getQualificationByConversationId,
  maybeAutoQualifyConversation,
  qualifyConversation,
} from '../services/qualificationService';
import { findConversationStateByConversationId } from '../repositories/conversationStatesRepository';
import { conversationService } from '../services/conversationService';
import { conversationMessageService } from '../services/conversationMessageService';
import {
  countConversations,
  listConversations as repoListConversations,
} from '../repositories/conversationRepository';
import {
  countMessagesByConversationId,
  listMessagesPage,
} from '../repositories/conversationMessageRepository';
import { leadRepository } from '../repositories/leadRepository';
import { logger } from '../utils/logger';

const MAX_MESSAGE_LENGTH = (): number => getChatMaxMessageLength();

/** Stored when the LLM returns tool calls without displayable text. */
const TOOL_CALL_ONLY_FALLBACK = 'Working on your request — one moment.';

const allowLegacyVoiceChannel = (): boolean => process.env.CHAT_ALLOW_LEGACY_VOICE === 'true';

const parsePositiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/** Persisted rows → LLM turns. Database-only metadata is never forwarded. */
const toLlmMessages = (rows: ConversationMessage[]): LlmMessage[] =>
  rows.map((m) => ({ role: m.role, content: m.content }));

export const createConversationHandler = async (
  req: ChatAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { leadId, channel } = req.body || {};
    const resolvedChannel = channel ?? 'web';
    if (!isConversationChannel(resolvedChannel)) {
      return res.status(400).json({
        success: false,
        error: { message: 'channel must be one of: web, whatsapp, legacy_voice', code: 400 },
      });
    }
    if (resolvedChannel === 'legacy_voice' && !allowLegacyVoiceChannel()) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'legacy_voice conversations cannot be created through the text API',
          code: 400,
        },
      });
    }
    if (leadId !== undefined && leadId !== null) {
      if (typeof leadId !== 'string' || leadId.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'leadId must be a non-empty string when supplied', code: 400 },
        });
      }
      const lead = await leadRepository.findById(leadId);
      if (!lead) {
        return res.status(400).json({
          success: false,
          error: { message: 'leadId does not reference an existing lead', code: 400 },
        });
      }
    }
    const conversation = await conversationService.createConversation({
      leadId: leadId ?? null,
      channel: resolvedChannel,
    });
    return res.status(201).json({ success: true, data: conversation });
  } catch (err) {
    return next(err);
  }
};

export const listConversationsHandler = async (
  req: ChatAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { leadId, status, channel } = req.query as Record<string, string | undefined>;
    if (status !== undefined && !isConversationStatus(status)) {
      return res.status(400).json({
        success: false,
        error: { message: 'status must be one of: active, completed, abandoned', code: 400 },
      });
    }
    if (channel !== undefined && !isConversationChannel(channel)) {
      return res.status(400).json({
        success: false,
        error: { message: 'channel must be one of: web, whatsapp, legacy_voice', code: 400 },
      });
    }
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
    const offset = (page - 1) * limit;
    const filter = {
      leadId: leadId || undefined,
      status: status as 'active' | 'completed' | 'abandoned' | undefined,
      channel: channel as 'web' | 'whatsapp' | 'legacy_voice' | undefined,
    };
    const [conversations, total] = await Promise.all([
      repoListConversations({ ...filter, limit, offset }),
      countConversations(filter),
    ]);
    return res.json({ success: true, data: { conversations, total, page, limit } });
  } catch (err) {
    return next(err);
  }
};

export const getConversationHandler = async (
  req: ChatAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const conversation = await conversationService.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { message: 'Conversation not found', code: 404 },
      });
    }
    const [lead, messageCount] = await Promise.all([
      conversation.lead_id ? leadRepository.findById(conversation.lead_id) : Promise.resolve(null),
      conversationMessageService.count(conversation.id),
    ]);
    return res.json({
      success: true,
      data: {
        conversation,
        lead: lead ? { id: lead.id, name: lead.name, phone: lead.phone, status: lead.status } : null,
        messageCount,
        status: conversation.status,
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const listConversationMessagesHandler = async (
  req: ChatAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const conversation = await conversationService.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { message: 'Conversation not found', code: 404 },
      });
    }
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
    const offset = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      listMessagesPage(conversation.id, limit, offset),
      countMessagesByConversationId(conversation.id),
    ]);
    return res.json({ success: true, data: { messages, total, page, limit } });
  } catch (err) {
    return next(err);
  }
};

export const postConversationMessageHandler = async (
  req: ChatAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const rawContent = req.body?.content;
    if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'content is required and must be a non-empty string', code: 400 },
      });
    }
    const content = rawContent.trim();
    if (content.length > MAX_MESSAGE_LENGTH()) {
      return res.status(400).json({
        success: false,
        error: {
          message: `content exceeds the maximum length of ${MAX_MESSAGE_LENGTH()} characters`,
          code: 400,
        },
      });
    }
    const conversation = await conversationService.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { message: 'Conversation not found', code: 404 },
      });
    }
    if (conversation.status !== 'active') {
      return res.status(409).json({
        success: false,
        error: {
          message: `Conversation is ${conversation.status} and no longer accepts messages`,
          code: 409,
        },
      });
    }

    const userMessage = await conversationMessageService.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content,
    });

    // Phase 4: text-safe state extraction BEFORE the LLM turn, so the current
    // turn's structured slots are visible in CURRENT CONVERSATION STATE.
    // Failures are isolated — extraction must never break the chat turn.
    let stateChanged = false;
    let extractedFields = 0;
    try {
      const extraction = await extractAndPersistTextState(conversation.id, content, {
        leadId: conversation.lead_id ?? null,
      });
      stateChanged = extraction.stateChanged;
      extractedFields = extraction.extractedFields;
    } catch (err: any) {
      logger.error('Text state extraction error (chat continues)', {
        conversationId: conversation.id,
        error: err?.message,
      });
    }

    // Multi-turn history window: chronological, bounded by
    // CHAT_MAX_CONTEXT_MESSAGES. Older persisted rows are retained in the
    // database; only the LLM input is truncated (token safety).
    const contextLimit = getChatMaxContextMessages();
    const history = await conversationMessageService.getRecent(conversation.id, contextLimit);

    let response;
    try {
      response = await orchestrator.processTurn({
        conversationId: conversation.id,
        context: {
          conversationId: conversation.id,
          leadId: conversation.lead_id ?? null,
          channel: conversation.channel,
        },
        channel: conversation.channel,
        messages: toLlmMessages(history),
      });
    } catch (err: any) {
      // LLM safety: the USER message stays persisted; no assistant message
      // (and no fake business action) is recorded on failure.
      logger.error('Conversation LLM turn failed (user message retained, no assistant persisted)', {
        conversationId: conversation.id,
        leadId: conversation.lead_id ?? null,
        stateChanged,
        extractedFields,
        historyMessages: history.length,
        contextLimit,
        error: err?.message,
      });
      throw err;
    }

    // Phase 5: conversation-anchored tools execute inside the orchestrator
    // loop (bounded by CHAT_MAX_TOOL_ROUNDS). The final assistant response
    // is persisted only after required tool execution completes — never
    // before. Tool activity is recorded as audit-safe metadata (tool names
    // + success flags only; no arguments, identities, or raw backend
    // errors reach the transcript or the customer).
    const assistantContent =
      response.content && response.content.trim().length > 0
        ? response.content
        : TOOL_CALL_ONLY_FALLBACK;
    const toolsExecuted = (response.executedTools ?? []).map((t) => ({
      name: t.name,
      success: t.success,
    }));
    const assistantMessage = await conversationMessageService.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: assistantContent,
      toolCalls: response.toolCalls ?? null,
      metadata: toolsExecuted.length > 0 ? { toolsExecuted } : null,
    });

    logger.info('Conversation message answered', {
      conversationId: conversation.id,
      leadId: conversation.lead_id ?? null,
      stateChanged,
      extractedFields,
      historyMessages: history.length,
      contextLimit,
      toolsExecuted,
      llmSuccess: true,
    });

    // Phase 6: controlled re-qualification after real state changes
    // (heuristic extraction or a successful updateConversationState tool).
    // Persistence only — no integration fan-out, so no message →
    // qualification → integration → message loop is possible.
    // maybeAutoQualifyConversation never throws; gated on sufficient info.
    let qualification: unknown = null;
    const toolsUpdatedState = toolsExecuted.some(
      (t) => t.name === 'updateConversationState' && t.success
    );
    if (stateChanged || toolsUpdatedState) {
      qualification = await maybeAutoQualifyConversation(
        conversation.id,
        stateChanged ? 'state_changed' : 'tool_update'
      );
    }

    return res.status(201).json({
      success: true,
      data: { conversation, userMessage, assistantMessage, qualification },
    });
  } catch (err) {
    return next(err);
  }
};

const endConversationHandler = (status: 'completed' | 'abandoned') => {
  return async (req: ChatAuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversation = await conversationService.getConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: { message: 'Conversation not found', code: 404 },
        });
      }
      if (conversation.status !== 'active' && conversation.status !== status) {
        return res.status(409).json({
          success: false,
          error: {
            message: `Conversation is ${conversation.status} and cannot transition to ${status}`,
            code: 409,
          },
        });
      }
      // No CRM/WhatsApp/n8n/calendar fan-out in this phase by design.
      const updated = await conversationService.endConversation(conversation.id, status);
      // Phase 6: completion recalculates qualification when sufficient data
      // exists (persistence only, no side effects). Abandoned conversations
      // are never qualified.
      let qualification: unknown = null;
      if (status === 'completed') {
        qualification = await maybeAutoQualifyConversation(conversation.id, 'completed');
      }
      return res.json({ success: true, data: { ...updated, qualification } });
    } catch (err) {
      return next(err);
    }
  };
};

/**
 * Phase 6: manual conversation qualification.
 * POST /api/v1/conversations/:id/qualification — same chat auth as the rest
 * of this router. Calculates via the existing scorer and persists anchored
 * on conversation_id (idempotent). Errors carry err.status (404/422).
 */
export const postConversationQualificationHandler = async (
  req: ChatAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const conversation = await conversationService.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { message: 'Conversation not found', code: 404 },
      });
    }
    const qualification = await qualifyConversation(conversation.id);
    return res.status(201).json({ success: true, data: qualification });
  } catch (err) {
    return next(err);
  }
};

/** Phase 9: read the persisted structured logistics state for the UI panel. */
export const getConversationStateHandler = async (
  req: ChatAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const conversation = await conversationService.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { message: 'Conversation not found', code: 404 },
      });
    }
    const state = await findConversationStateByConversationId(conversation.id);
    return res.json({ success: true, data: state });
  } catch (err) {
    return next(err);
  }
};

/** Read the persisted conversation qualification, if any. */
export const getConversationQualificationHandler = async (
  req: ChatAuthRequest,
  res: Response,
  next: NextFunction
) => {  try {
    const conversation = await conversationService.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { message: 'Conversation not found', code: 404 },
      });
    }
    const qualification = await getQualificationByConversationId(conversation.id);
    if (!qualification) {
      return res.status(404).json({
        success: false,
        error: { message: 'Qualification not found for this conversation', code: 404 },
      });
    }
    return res.json({ success: true, data: qualification });
  } catch (err) {
    return next(err);
  }
};

export const completeConversationHandler = endConversationHandler('completed');
export const abandonConversationHandler = endConversationHandler('abandoned');
