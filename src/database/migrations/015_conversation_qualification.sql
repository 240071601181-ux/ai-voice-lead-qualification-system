-- 015_conversation_qualification.sql (Phase 6 – Conversation-based lead qualification)
-- Additive only. No old migration is edited; legacy voice keeps working.
--
-- Context: migration 005 made qualifications.call_id NOT NULL UNIQUE, and 014
-- added a nullable qualifications.conversation_id bridge. Phase 6 makes
-- conversation_id the primary anchor for text (web/WhatsApp) qualifications:
--   - new web/WhatsApp rows → conversation_id populated, call_id NULL
--   - legacy voice rows   → call_id populated (unchanged behavior)
--   - bridged legacy rows → both populated
-- Scoring logic is untouched; this migration only enables persistence.

-- Allow text qualifications without inventing a callId. The UNIQUE
-- constraint on call_id stays: Postgres treats NULLs as distinct, so any
-- number of conversation-anchored rows can coexist with legacy call rows.
ALTER TABLE qualifications
    ALTER COLUMN call_id DROP NOT NULL;

-- Idempotency support: one qualification row per conversation. Partial so
-- legacy call-anchored rows (conversation_id IS NULL) are unaffected.
-- Enables ON CONFLICT (conversation_id) WHERE conversation_id IS NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS qualifications_conversation_id_unique_idx
    ON qualifications (conversation_id) WHERE conversation_id IS NOT NULL;
