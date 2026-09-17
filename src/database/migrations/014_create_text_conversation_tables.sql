-- 014_create_text_conversation_tables.sql (Phase 2 – Text-first conversation persistence)
-- Additive only. Existing calls/conversation_state/qualifications structures
-- are untouched; legacy voice keeps working. New text conversations persist in
-- conversations + conversation_messages + conversation_states, with a nullable
-- qualifications.conversation_id bridge for the next phase.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Text conversations: conversationId is the primary AI identity.
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NULL REFERENCES leads(id) ON DELETE SET NULL,
    channel VARCHAR(20) NOT NULL
        CHECK (channel IN ('web', 'whatsapp', 'legacy_voice')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'abandoned')),
    started_at TIMESTAMPTZ NULL,
    ended_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversations_lead_id_idx
    ON conversations (lead_id) WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_status_idx
    ON conversations (status);

CREATE INDEX IF NOT EXISTS conversations_created_at_idx
    ON conversations (created_at DESC);

-- Chronological message history per conversation.
CREATE TABLE IF NOT EXISTS conversation_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL
        CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    metadata JSONB NULL,
    tool_calls JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_messages_conversation_created_idx
    ON conversation_messages (conversation_id, created_at ASC, id ASC);

-- Slot state per text conversation. Mirrors conversation_state field types
-- (003 + 006) but keyed by conversation_id. The old conversation_state table
-- remains the temporary source of truth for legacy voice.
CREATE TABLE IF NOT EXISTS conversation_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    lead_id UUID NULL REFERENCES leads(id) ON DELETE SET NULL,
    customer_name VARCHAR(255) NULL,
    pickup_location VARCHAR(255) NULL,
    destination VARCHAR(255) NULL,
    vehicle_type VARCHAR(100) NULL,
    cargo_type VARCHAR(100) NULL,
    cargo_weight NUMERIC NULL,
    cargo_dimensions TEXT NULL,
    required_date DATE NULL,
    budget NUMERIC NULL,
    urgency VARCHAR(50) NULL,
    booking_intent VARCHAR(20) NULL
        CHECK (booking_intent IS NULL OR booking_intent IN ('explicit', 'not_explicit', 'unknown')),
    additional_requirements TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Qualification bridge: nullable conversation anchor for the next phase.
-- call_id stays NOT NULL UNIQUE; no scoring logic changes.
ALTER TABLE qualifications
    ADD COLUMN IF NOT EXISTS conversation_id UUID NULL REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS qualifications_conversation_id_idx
    ON qualifications (conversation_id) WHERE conversation_id IS NOT NULL;

-- updated_at triggers (mirrors 001/003 style, one function per table).
CREATE OR REPLACE FUNCTION update_updated_at_column_conversations()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_conversations ON conversations;
CREATE TRIGGER set_timestamp_conversations
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column_conversations();

CREATE OR REPLACE FUNCTION update_updated_at_column_conversation_states()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_conversation_states ON conversation_states;
CREATE TRIGGER set_timestamp_conversation_states
BEFORE UPDATE ON conversation_states
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column_conversation_states();
