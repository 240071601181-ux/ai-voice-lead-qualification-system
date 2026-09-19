# Dashboard Analytics (Phase 17)

All dashboard numbers come from backend aggregates — nothing is fabricated.

## Qualification mix

`GET /api/v1/dashboard/qualification-mix` → `{ total, hot, warm, cold }`
from one `GROUP BY tier` query over `qualifications` (unknown tiers
ignored). The donut renders shares from these counts with a conic-gradient;
percentages are computed in the browser from the same four numbers.

Empty state (total 0): "No qualification data yet. Complete conversations
to build the qualification mix." No trend percentages are shown anywhere —
no historical trend endpoint exists, so the old "up 8.4%" claim was
removed rather than replaced with another invention.

## Metric cards

Live list `total`s only (page 1, limit 1): leads, qualifications,
conversations, calendar bookings. Deltas read "live total" (a label, not a
number). Unavailable endpoints render "—", never estimates.

## Agent health

See `docs/agent-health.md` (`GET /api/v1/agent/health-metrics`: status
counts, qualification rate, mean first-response seconds; quality always
`null` with a reason).
