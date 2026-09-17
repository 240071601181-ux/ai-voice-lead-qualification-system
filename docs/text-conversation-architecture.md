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

## Persistence layer (Phase 2)

Migration `014_create_text_conversation_tables.sql` (additive; `001–013`
untouched):

```
Lead
 ↓
Conversation (conversations: id, lead_id → leads, channel, status,
│             started_at, ended_at, created/updated_at)
 ├── Messages (conversation_messages: conversation_id → conversations
 │             CASCADE, role system|user|assistant|tool, content,
 │             metadata JSONB, tool_calls JSONB, created_at;
 │             indexed (conversation_id, created_at) for chronological reads)
 └── Conversation State (conversation_states: conversation_id UNIQUE →
                        conversations CASCADE, same slot columns/types as
                        the legacy table; future source of truth)
 ↓
AgentOrchestrator
```

- `qualifications.conversation_id` (nullable FK → conversations, partial
  index) is a compatibility bridge; `call_id` stays `NOT NULL UNIQUE` and
  scoring logic is unchanged.
- Repositories: `conversationRepository` (create/getById/listByLeadId/
  updateStatus/end), `conversationMessageRepository` (create/
  listByConversationId/count/listRecentMessages),
  `conversationStatesRepository` (get/create/update).
- Services: `ConversationService` (lifecycle + validation) and
  `ConversationMessageService` (append/history/recent/count) — no LLM logic.
- `getStateByConversationId` now reads `conversation_states` first, then a
  linked legacy call, then `null`. `getStateByCallId` and the old
  `conversation_state` table are unchanged and remain the temporary source
  of truth for voice.
- `calls` and old `conversation_state` remain legacy until Phase 9.
