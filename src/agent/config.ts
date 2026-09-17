/**
 * Core agent behavior (transport-independent).
 * Applies equally to text conversations (web/WhatsApp) and legacy voice calls:
 * logistics sales prompting, multilingual support, qualification questions,
 * and turn-taking rules. Keep this section free of telephony/voice settings.
 */
export const agentConfig = {
  systemPrompt: `You are an AI sales assistant for a logistics and transport company.
Your job is to understand the customer's shipping requirements and collect relevant information naturally in Tamil, Hindi, or English.

Ask concise, relevant questions.
Store confirmed information in conversation state.
Do not invent customer information.
Confirm important details before proceeding.
Do not make pricing or availability promises unless verified by a tool.`,
  supportedLanguages: ['en', 'hi', 'ta'],
  languages: ['en', 'hi', 'ta'],
  qualificationQuestions: [
    'What is the customer name?',
    'What is the pickup location?',
    'What is the destination?',
    'What type of vehicle is required?',
    'What type of cargo is being transported?',
    'What is the cargo weight?',
    'When is the required delivery date?',
    'What is your budget for this shipment?',
    'How urgent is this requirement?',
    'Are there any additional requirements?'
  ],
  conversationRules: {
    maxTurns: 20,
    allowCodeSwitch: true,
    requireConfirmation: true
  }
};

/**
 * Text conversation defaults (Phase 1).
 * Reuses the core turn-taking budget above so there is a single source of
 * truth; `defaultChannel` selects the transport for new conversations.
 * Voice/telephony operation settings (assistant IDs, phone numbers, voice
 * labels in agentConfigService) intentionally live outside this module's
 * core behavior and remain untouched for legacy compatibility.
 */
export const textConversationDefaults = {
  defaultChannel: 'web' as const,
  maxTurns: agentConfig.conversationRules.maxTurns,
};
