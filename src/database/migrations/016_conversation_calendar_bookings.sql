-- 016_conversation_calendar_bookings.sql (Phase 8 – Conversation-based meeting scheduling)
-- Additive only. No old migration is edited; legacy call-based bookings keep
-- working. Text-conversation bookings anchor on conversation_id; call_id is
-- never fabricated for them (stays NULL, which the schema already allows).

ALTER TABLE calendar_bookings
    ADD COLUMN IF NOT EXISTS conversation_id UUID NULL REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS calendar_bookings_conversation_id_idx
    ON calendar_bookings (conversation_id) WHERE conversation_id IS NOT NULL;
