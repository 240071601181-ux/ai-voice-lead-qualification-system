# n8n — Optional External Automation (Phase 15)

n8n is **optional**. Core MadVoice workflows run fully with `N8N_ENABLED=false`
(the default when unset). No conversation, message, state extraction,
qualification, CRM, WhatsApp, calendar, or follow-up operation fails when
n8n is disabled or unreachable.

## Architecture

```
Conversation → Qualification → Backend business services
                                  ├── CRM (direct provider when configured)
                                  ├── WhatsApp (direct provider when configured)
                                  ├── Calendar
                                  └── Follow-ups (scheduled rows)

Optional fan-out (fire-and-forget, never awaited):

Backend event → n8n → external/custom workflows
```

## Behavior by flag

| `N8N_ENABLED` | Emission | Core workflows | UI |
| ------------- | -------- | -------------- | -- |
| `false` (default) | none — `enqueueN8nEvent` returns before any work; no HTTP, no retries, no noise | unaffected | Automation page shows "n8n is not configured" + "n8n is optional"; sidebar badge "Optional" |
| `true` | existing HMAC signing, retry, idempotency (`event_id` + payload-hash dedupe), allowlisted payloads | unaffected (emission is `setImmediate` fire-and-forget; failures recorded, never thrown) | "Operational" only when secret + workflows are actually configured |

## Failure handling

n8n delivery failure is recorded in `n8n_deliveries` (`failed` + sanitized
message) and logged — it never fails the enclosing business operation
(message send, qualification, booking, sync). Skipped states (`disabled`,
`no_workflow`, `no_config`, `no_data`, `no_changes`) are recorded the same
way. Webhook secrets stay server-only: diagnostics report presence only,
payloads and URLs are never exposed to the browser, and error sanitization
redacts secret-like text before logging or persisting.

## Configuration (backend `.env`, never committed)

```text
N8N_ENABLED=false
N8N_WEBHOOK_SECRET=<server-only secret>
# Either one webhook for all events:
N8N_WEBHOOK_URL=https://your-n8n.example/webhook/lead-events
# Or per-event fan-out:
# N8N_WORKFLOWS_JSON={"lead.created":[{"name":"lead-pipeline","url":"https://..."}]}
N8N_TIMEOUT_MS=8000
N8N_MAX_RETRIES=3
N8N_RETRY_BASE_DELAY_MS=500
N8N_ALLOW_HTTP_LOCAL=false
```

Restart the backend after changing these. Delivery history (`n8n_deliveries`)
is queryable via `GET /api/v1/n8n/diagnostics` and
`GET /api/v1/n8n/workflows` (names/events/stats only — never URLs).
