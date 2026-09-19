export type UpdateLeadInformationPayload = {
  leadId: string;
  updates: Partial<{
    source: string;
    name: string;
    phone: string;
    email: string;
    status: string;
  }>;
};

export type UpdateConversationStatePayload = {
  callId: string;
  updates: Partial<{
    customer_name: string;
    pickup_location: string;
    destination: string;
    vehicle_type: string;
    cargo_type: string;
    cargo_weight: number;
    cargo_dimensions: string;
    required_date: string; // ISO date or YYYY-MM-DD
    budget: number;
    urgency: string;
    booking_intent: 'explicit' | 'not_explicit' | 'unknown';
    additional_requirements: string;
  }>;
};

export interface ToolResult {
  success: boolean;
  message?: string;
  errors?: string[];
}

export const validateUpdateLeadPayload = (payload: any): string[] => {
  const errors: string[] = [];
  if (!payload || typeof payload !== 'object') {
    errors.push('Payload must be an object');
    return errors;
  }
  if (!payload.leadId || typeof payload.leadId !== 'string') {
    errors.push('leadId is required and must be a string');
  }
  if (!payload.updates || typeof payload.updates !== 'object') {
    errors.push('updates object is required');
  }
  return errors;
};

export const validateUpdateConversationStatePayload = (payload: any): string[] => {
  const errors: string[] = [];
  if (!payload || typeof payload !== 'object') {
    errors.push('Payload must be an object');
    return errors;
  }
  if (!payload.callId || typeof payload.callId !== 'string') {
    errors.push('callId is required and must be a string');
  }
  if (!payload.updates || typeof payload.updates !== 'object') {
    errors.push('updates object is required');
  } else {
    if (payload.updates.cargo_weight !== undefined && typeof payload.updates.cargo_weight !== 'number') {
      errors.push('cargo_weight must be a number');
    }
    if (payload.updates.budget !== undefined && typeof payload.updates.budget !== 'number') {
      errors.push('budget must be a number');
    }
    if (payload.updates.cargo_dimensions !== undefined && typeof payload.updates.cargo_dimensions !== 'string') {
      errors.push('cargo_dimensions must be a string');
    }
    if (payload.updates.booking_intent !== undefined && !['explicit', 'not_explicit', 'unknown'].includes(payload.updates.booking_intent)) {
      errors.push('booking_intent must be explicit, not_explicit, or unknown');
    }
  }
  return errors;
};

/**
 * Phase 14 — the voice-only `endCall` tool (and its payload/validator) is
 * retired with the Vapi services. The text assistant allowlist in
 * conversationTools.ts never included it.
 */
import { updateState } from '../services/conversationStateService';
import { updateLead } from '../repositories/leadRepository';
import { logger } from '../utils/logger';

export const updateLeadInformation = async (payload: UpdateLeadInformationPayload): Promise<ToolResult> => {
  const errors = validateUpdateLeadPayload(payload);
  if (errors.length > 0) {
    return { success: false, errors };
  }
  try {
    const updatedLead = await updateLead(payload.leadId, payload.updates);
    if (!updatedLead) {
      return { success: false, message: `Lead with ID ${payload.leadId} not found` };
    }
    logger.info('Tool updateLeadInformation executed successfully', { leadId: payload.leadId });
    return { success: true, message: 'Lead information updated successfully' };
  } catch (err: any) {
    logger.error('Error in updateLeadInformation tool', { error: err.message });
    return { success: false, errors: [err.message] };
  }
};

export const updateConversationState = async (payload: UpdateConversationStatePayload): Promise<ToolResult> => {
  const errors = validateUpdateConversationStatePayload(payload);
  if (errors.length > 0) {
    return { success: false, errors };
  }
  try {
    const updatedState = await updateState(payload.callId, payload.updates);
    if (!updatedState) {
      return { success: false, message: `Conversation state for callId ${payload.callId} not found` };
    }
    logger.info('Tool updateConversationState executed successfully', { callId: payload.callId });
    return { success: true, message: 'Conversation state updated successfully' };
  } catch (err: any) {
    logger.error('Error in updateConversationState tool', { error: err.message });
    return { success: false, errors: [err.message] };
  }
};
