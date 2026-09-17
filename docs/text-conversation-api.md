# Text Conversation API (Phase 3)

Backend API for text conversations. All endpoints live under
`/api/v1/conversations`, require a bearer token, and are rate-limited.
Vapi/call routes are untouched. No frontend, no qualification, and no
integration fan-out in this phase.

## Authentication

`Authorization: Bearer <HS256-JWT>` on every request, verified by
`middleware/conversationAuth.ts` (Node `crypto`, no new dependencies).
Fail-closed: missing/invalid/expired tokens and an unset `CHAT_JWT_SECRET`
all return `401`. No user store exists — the token carries an opaque `sub`
and issuance is the deployer's responsibility (`signChatToken` is available
for tests/tooling).

## Rate limiting

`middleware/chatRateLimit.ts`, in-memory sliding window, per limiter store:

- General (reads, lifecycle): `CHAT_RATE_LIMIT_WINDOW_MS` (default 60000),
  `CHAT_RATE_LIMIT_MAX` (default 60) per IP.
- Message sends: `CHAT_MESSAGE_RATE_LIMIT_MAX` (default 20) per IP per window.
- Exceeded → `429 { success:false, error:{ message, code:429 } }`.

Applies only to the conversation router. Single-process memory store —
a shared store is required before horizontal scaling (Phase 10).

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/conversations` | Create (`{ leadId?, channel? }` → `201` + record; defaults `web`/`active`; `legacy_voice` rejected unless `CHAT_ALLOW_LEGACY_VOICE=true`; unknown `leadId` → `400`) |
| `GET` | `/api/v1/conversations?leadId=&status=&channel=&page=&limit=` | Filtered list, newest-first, capped at 100/page (`200 { conversations, total, page, limit }`) |
| `GET` | `/api/v1/conversations/:id` | Record + lead summary (`{ id, name, phone, status }`) + `messageCount` + `status`; no history |
| `GET` | `/api/v1/conversations/:id/messages?page=&limit=` | Chronological page (`200 { messages, total, page, limit }`) |
| `POST` | `/api/v1/conversations/:id/messages` | Send (`{ content }` → `201 { conversation, userMessage, assistantMessage }`) |
| `POST` | `/api/v1/conversations/:id/complete` | `active → completed`, sets `ended_at` |
| `POST` | `/api/v1/conversations/:id/abandon` | `active → abandoned` |

## Message lifecycle

1. Authenticate + message rate-limit check.
2. Conversation must exist (`404`) and be `active` (`409` otherwise).
3. `content` trimmed; empty → `400`; longer than `CHAT_MAX_MESSAGE_LENGTH`
   (default 4000) → `400`.
4. USER message persisted (`conversation_messages`).
5. Full history reloaded (chronological) and mapped to `LlmMessage`
   (`system/user/assistant/tool`); DB-only metadata is never forwarded.
6. `AgentOrchestrator.processTurn({ conversationId, context:
   { conversationId, leadId, channel }, channel, messages })` — same
   LLM + selective RAG + state pipeline as voice; legacy `call_id` state is
   never consulted for web/whatsapp turns.
7. ASSISTANT message persisted. LLM `toolCalls` (if any) are stored in the
   `tool_calls` column for Phase 5 — they are **not executed** here, and raw
   LLM output can never reach SQL or the filesystem.
8. Response contains only the conversation and the two persisted messages —
   never prompts, tool definitions, keys, or chain-of-thought.

## Error codes

`400` invalid payload · `401` unauthenticated/unconfigured auth ·
`404` conversation not found · `409` conversation not active (or illegal
terminal transition) · `429` rate limited · `500` unexpected failure
(central handler, no stack traces or secrets).

## Example flow

```
POST /api/v1/conversations            { "leadId": "<uuid>", "channel": "web" }
→ 201 { id: "<conversationId>", status: "active", ... }

POST /api/v1/conversations/<conversationId>/messages   { "content": "I need a 14ft truck from Chennai to Bengaluru" }
→ 201 { conversation, userMessage, assistantMessage }

GET  /api/v1/conversations/<conversationId>/messages?page=1&limit=20
→ 200 { messages: [user, assistant, ...], total, page, limit }

POST /api/v1/conversations/<conversationId>/complete
→ 200 { status: "completed", ended_at: "..." }
```

## Authorization limitation (honest)

There is no workspace/user ownership model in the database, so any valid
token can access any conversation (single-tenant assumption). Do not claim
multi-tenant isolation. Per-conversation ownership/ACLs are Phase 10 work.

## Environment

`CHAT_JWT_SECRET` (required, fail-closed) · `CHAT_RATE_LIMIT_WINDOW_MS` ·
`CHAT_RATE_LIMIT_MAX` · `CHAT_MESSAGE_RATE_LIMIT_MAX` ·
`CHAT_MAX_MESSAGE_LENGTH` · `CHAT_ALLOW_LEGACY_VOICE`. See `.env.example`.
