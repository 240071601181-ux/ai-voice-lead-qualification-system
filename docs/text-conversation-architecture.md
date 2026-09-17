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

## Phase 4 — multi-turn text agent (history → state → RAG → LLM)

Per-turn flow (text only; Vapi/call path unchanged):

```
Message history (persisted, chronological)
  → state resolution (conversation_states by conversationId)
  → state extraction from current user turn (validated, text-safe)
  → state persistence (deterministic merge)
  → selective RAG (topK 3, threshold 0.3; skipped for trivial messages)
  → LLM (bounded history window)
  → assistant message persistence
```

Prompt context is assembled deterministically in `AgentOrchestrator`:

```
System/business instructions (agent/config.ts, unchanged)
  → operator configuration (live)
  → text-turn guidance (TEXT_TURN_GUIDANCE, additive)
  → CURRENT CONVERSATION STATE (structured slots)
  → RETRIEVED KNOWLEDGE BASE CONTEXT (only when selective RAG fires)
  → recent conversation history (role + content only, chronological)
  → current user turn (last history row)
```

Notes:

- History: every turn loads prior rows in chronological order and forwards
  only `{ role, content }` — DB metadata (ids, timestamps, `metadata`,
  `tool_calls`) never reaches the LLM, persisted system rows are filtered so
  the assembled system prompt is never duplicated, and tool payloads are
  never injected as user text. `CHAT_MAX_CONTEXT_MESSAGES` (default 30,
  `src/config`) bounds the forwarded window via `limitContextMessages()`
  (also enforced inside the orchestrator as defense-in-depth); older rows
  stay persisted and are simply not forwarded.
- State extraction (`src/agent/textStateExtraction.ts`, pure data logic —
  no SQL/filesystem/tool execution): deterministic heuristic over the
  current user message → `validateTextStateUpdate()` (whitelisted slots,
  unknown/invalid values dropped, SQL/code patterns rejected; arbitrary
  LLM JSON goes through the same validator) → `mergeTextConversationState()`
  → `extractAndPersistTextState()` in `conversationStateService.ts` writes
  to `conversation_states` via parameterized repository calls only.
- State merge: unknown/null/empty values leave existing fields unchanged;
  known values overwrite; unrelated fields are preserved. Example:
  `pickup=Chennai, destination=Bengaluru` + `"Actually pickup should be
  Tambaram."` → `pickup=Tambaram, destination=Bengaluru`.
- RAG: `isKnowledgeSearchRequired()` keeps the Phase 1/3 decision
  mechanism and the same embedding/retrieval implementation
  (`topK: 3`, threshold `0.3`, exported as `RAG_TOP_K` /
  `RAG_SIMILARITY_THRESHOLD`); keyword coverage was extended so fleet /
  operating-hours questions (`What vehicles do you provide?`, `Do you
  operate on Sundays?`, `What are your cargo restrictions?`) retrieve while
  trivial messages (`Hi`, `Okay`, `Thanks`) never do.
- Safety: the user message is persisted before the LLM call; if the LLM
  fails the API returns a safe error, no assistant message (and no fake
  business action) is recorded, and secrets/system prompts never leak.
- Observability (structured, no secrets/prompts/keys, message bodies only
  as a 120-char preview + length): `conversationId`, `leadId`, `channel`,
  `ragUsed`, `ragChunkCount`, `stateChanged`, `extractedFields`,
  `contextMessages`/`historyMessages`, `llmSuccess`.
