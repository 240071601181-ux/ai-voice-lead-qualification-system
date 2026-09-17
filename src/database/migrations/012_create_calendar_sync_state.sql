-- 012_create_calendar_sync_state.sql
-- Single-row table holding the latest calendar connectivity-check outcome
-- ("Sync now"). Updated on every POST /api/v1/calendar/sync run; read by
-- GET /api/v1/calendar/sync-status so the UI survives refresh. No secrets
-- are ever persisted here (status + timestamps + sanitized message only).

CREATE TABLE IF NOT EXISTS calendar_sync_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed')),
    last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
