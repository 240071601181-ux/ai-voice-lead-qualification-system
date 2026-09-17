-- 013_create_workspace_settings.sql
-- Single-row table holding the persisted workspace settings shown on the
-- Settings page (workspace defaults + notification toggles). Updated via
-- PATCH /api/v1/settings; read by GET /api/v1/settings so the UI survives
-- navigation and refresh. No secrets are ever persisted here (display
-- preferences and boolean flags only).

CREATE TABLE IF NOT EXISTS workspace_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    workspace_name VARCHAR(100) NOT NULL DEFAULT 'Acme Cargo',
    timezone VARCHAR(60) NOT NULL DEFAULT 'Asia/Kolkata',
    default_language VARCHAR(20) NOT NULL DEFAULT 'English',
    lead_score_threshold INTEGER NOT NULL DEFAULT 70 CHECK (lead_score_threshold >= 0 AND lead_score_threshold <= 100),
    notify_hot_lead BOOLEAN NOT NULL DEFAULT TRUE,
    notify_integration_failure BOOLEAN NOT NULL DEFAULT TRUE,
    notify_followup_due BOOLEAN NOT NULL DEFAULT TRUE,
    notify_daily_digest BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO workspace_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
