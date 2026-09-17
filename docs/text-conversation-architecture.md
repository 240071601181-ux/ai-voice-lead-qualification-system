# Text Conversation Architecture (Phase 1 — Compatibility)

MadLead AI is migrating from voice calls to text conversations. Phase 1 introduces
the conversation-first architecture **without removing the legacy voice path**.
`conversationId` is the primary identity for AI conversations; `callId` is
temporary compatibility infrastructure until Phase 9 removes Vapi.

## Current compatibility architecture

Text (new, preferred):

```
Lead
 ↓
Conversation (conversationId, channel: web | whatsapp)
 ↓
AgentOrchestrator.processTurn({ conversationId, messages, ... })
 ↓
Conversation state → RAG → LLM → Tools → response
```

Legacy (compatibility, unchanged behavior):

```
Lead
 ↓
Call / Vapi (callId)
 ↓
AgentOrchestrator.processTurn({ callId, messages, ... })
 ↓
Call-anchored state → RAG → LLM → Tools → response
```

## What Phase 1 added

- `src/agent/conversation.ts` — transport-independent domain model:
  `Conversation`, `ConversationChannel` (`web | whatsapp | legacy_voice`),
  `ConversationStatus` (`active | completed | abandoned`), `AgentContext`
  (`conversationId?`, `callId?`, `leadId?`, `channel?`), string-array
  validators (repo convention), and `resolveAgentIdentity` which always
  prefers `conversationId` over `callId`.
- `AgentOrchestrator.processTurn` accepts `conversationId` (preferred),
  `callId` (legacy), an optional reusable `context`, and `channel`.
  One code path: identity resolution → state lookup → selective RAG
  (`topK:3`, threshold `0.3`) → prompt assembly → LLM provider.
  LLM, RAG, prompt, tools, and qualification logic are reused, not duplicated.
- `getStateByConversationId(conversationId, { linkedCallId? })` in
  `services/conversationStateService.ts`. No conversation-state table exists
  yet, so unlinked ids resolve to `null` (orchestrator proceeds stateless);
  explicitly linked ids delegate to the existing call lookup.
  `getStateByCallId` is untouched.
- `src/agent/config.ts` — core behavior (prompt, languages, qualification
  questions, turn rules) marked transport-independent; additive
  `textConversationDefaults` (`defaultChannel: 'web'`, shared `maxTurns`
  budget). No voice config removed.

## Compatibility guarantees

- All Vapi routes, webhook handlers, call services, and `callId` tool paths
  are unchanged and still compile.
- No database migrations were created or altered; no `calls` /
  `conversation_state` schema changes.
- No frontend changes.

## Phase 2 (not started)

Back `getStateByConversationId` with `conversations` / `messages` /
`conversation_states` tables, add the conversation message API, then wire
qualification and integrations to `conversationId`.
