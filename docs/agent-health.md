# Agent Health Metrics (Phase 15)

`GET /api/v1/agent/health-metrics` returns **real PostgreSQL aggregates** —
no invented numbers, no frontend-array math.

## Metrics

| Metric | Source | Empty state |
| ------ | ------ | ----------- |
| Text conversations (`total/active/completed/abandoned`) | `SELECT status, COUNT(*) FROM conversations GROUP BY status` | zeros |
| Qualification rate (`qualifiedConversations/totalConversations/ratePercent`) | `COUNT(DISTINCT conversation_id)` from `qualifications` ÷ conversation total | `ratePercent: null` when total is 0 |
| Avg. first response (`avgFirstResponseSec`, `conversationsMeasured`) | mean seconds from first `user` message to first later `assistant` message (single SQL pass; conversations without that pair excluded) | `null` / `0` |
| Conversation quality | **always `null`** — no deterministic quality metric exists | `qualityReason` explains why |

## UI rules (AI Agent → Agent health)

- Show measured values; show **"N/A"** (never `--` as a value, never an
  estimate) when a metric is unavailable.
- Status badge uses the real agent state: **Active** / **Paused**
  (backend `paused` flag) — never "Standby".
- "No metrics" is not presented as healthy: the footer states what is live
  and that quality has no deterministic metric.

## Performance

Single bounded aggregate queries per request (GROUP BY + one join pass);
message bodies are never loaded into Node. `staleTime: 30s` on the
frontend query avoids refetch storms.
