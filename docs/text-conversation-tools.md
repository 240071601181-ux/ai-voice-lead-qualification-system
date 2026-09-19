# Text Conversation Tools (Phase 5 — Conversation-Anchored Execution)

> **Phase 14:** the Vapi/call dispatcher (`handleVapiToolCalls`) and the
> voice-only `endCall` tool are retired (deleted). The explicit text
> allowlist below is unchanged and is now the sole tool surface.

Phase 4 persisted LLM `toolCalls` without executing them. Phase 5 executes a
safe subset for text conversations with `conversationId` as the primary
identity.

## Available tools (text)

| Tool | Effect | Identity |
| --- | --- | --- |
| `updateConversationState` | Writes whitelisted shipment slots to `conversation_states` by `conversationId` (deterministic merge) | Trusted `conversationId` (+ `leadId` for row creation) |
| `updateLeadInformation` | Updates contact fields of the linked lead only | Trusted `leadId` from the conversation record |
| `getConversationState` | Read-only summary of this conversation's stored slots (answers "what's my pickup?") | Trusted `conversationId` |

Retired (Phase 14, not exposed and no longer present): `endCall`
(voice-call lifecycle). No generic
`queryDatabase` / `executeSQL` / `runCommand` / `fetchURL` tool exists —
verified by grep and by the allowlist test.

## Audit of the existing framework (`src/agent/tools.ts`)

- `updateLeadInformation` — **safe/reusable (A)**: parameterized `UPDATE
  leads`, repository-whitelisted columns. Phase 5 adds a text wrapper that
  resolves the lead from the conversation and strictly validates fields.
- `updateConversationState` — **call-specific, adapted (B)**: requires
  `callId`, writes the legacy table. Untouched; the text equivalent lives in
  `src/agent/conversationTools.ts` and writes `conversation_states`.
- `endCall` — **retired (Phase 14)**: the voice-call tool and its
  `handleEnded` executor were deleted with the voice services. The text
  dispatcher rejects it as unknown.
- Validators and `ToolResult` are reused/extended, not replaced — there is
  exactly one tool framework plus one thin conversation-anchored dispatcher.

## Trusted identity resolution

The backend resolves `{ conversationId, leadId }` from the authenticated
conversation record in `postConversationMessageHandler` and passes it through
`AgentOrchestrator.processTurn({ conversationId, context: { ... } })` into
`dispatchConversationTool(ctx, name, rawArgs)`.

- Any LLM-supplied `leadId` / `conversationId` / `callId` / `userId`
  (top-level or inside `updates`) is **ignored** (top level) or **rejected**
  (inside `updates`).
- `updateLeadInformation` with no linked lead fails safely instead of
  touching another lead.
- `getConversationState` reads only the calling conversation's row.

## Argument validation

- `updateConversationState`: only the 12 whitelisted slot fields
  (`customer_name`, `pickup_location`, `destination`, `vehicle_type`,
  `cargo_type`, `cargo_weight`, `cargo_dimensions`, `required_date`,
  `budget`, `urgency`, `additional_requirements`, `booking_intent`);
  identity/internal/arbitrary keys rejected; types, enums, and SQL/code
  patterns enforced by the shared Phase 4 validator; empty updates rejected.
- `updateLeadInformation`: only `source/name/phone/email/status`
  (non-empty strings ≤ 500 chars); protected keys (`id`, `leadId`,
  `conversationId`, timestamps, …) rejected; unknown keys rejected.
- Malformed JSON / non-object arguments are rejected, never executed.
- All persistence uses parameterized repository calls; no module builds SQL.

## Execution flow

```
load state → RAG → LLM ─┬─ no tool calls → final response
                         └─ tool calls → validate name → validate args
                            → inject trusted context → execute →
                            append assistant(tool_calls) + tool results →
                            LLM again → … → final response
```

- Text turns advertise `getTextToolDefinitions()` when the caller supplies
  no tools.
- The final assistant message is persisted only after the loop finishes —
  never before required tool execution completes.

## Maximum tool rounds

`CHAT_MAX_TOOL_ROUNDS` (default 3, clamp 1–10, `src/config`). Per user
message: unknown tool → safe rejection text; invalid arguments → safe tool
error; repeated failure → loop still terminates; budget exhausted with calls
pending → unexecuted calls dropped (never persisted as done) with a safe
fallback message. No infinite loop is possible.

## Error behavior

A tool failure never crashes the turn, corrupts state, or fabricates
success text. The LLM receives a structured, sanitized error
(`sanitizeToolError()` strips SQL/connection/table internals) so it can
explain the limitation naturally. Stack traces, SQL, and database details
never reach the transcript or the client.

## Persistence

`conversation_messages` stores the final assistant message with `tool_calls`
(when the final response carries them) and audit-safe `metadata`
`{ toolsExecuted: [{ name, success }] }` — names and flags only, no
arguments or errors. Intermediate assistant/tool messages stay in the LLM
context, not in the database.

## Observability

Structured logs per execution: `conversationId`, `leadId`, `tool`,
`success`/`success`, `durationMs`, `round`/`maxRounds`, `executedTools`.
Never logged: secrets, JWTs, full sensitive message content (120-char
preview + length only), raw database errors.
