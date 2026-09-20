-- 018_admin_roles_and_customer_access.sql (Phase 20 – Admin vs Customer separation)
-- Additive only. No old migration is edited; no existing data is destroyed.
--
-- 1. users.role: small internal role model (ADMIN | OPERATOR). Existing rows
--    keep working and default to OPERATOR (safe default); deployers promote
--    administrators explicitly (SQL or BOOTSTRAP_ADMIN_EMAIL at register).
--    There is deliberately NO customer role here: customers are external
--    leads/conversations, never rows in users.
-- 2. customer_access_tokens: single-use-issued, hashed, expiring, revocable
--    bearer tokens that grant exactly one conversation's chat. Raw tokens are
--    never stored — only the SHA-256 HMAC hash.
-- 3. customer_sessions: opaque hashed session tokens (HttpOnly cookie
--    transport) minted by redeeming an access token. Revocable, expiring,
--    scoped to exactly one conversation.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Internal roles -------------------------------------------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'OPERATOR'
        CHECK (role IN ('ADMIN', 'OPERATOR'));

CREATE INDEX IF NOT EXISTS users_role_idx
    ON users (role);

-- 2. Customer access tokens (one conversation each) ------------------------
CREATE TABLE IF NOT EXISTS customer_access_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_access_tokens_conversation_idx
    ON customer_access_tokens (conversation_id);

CREATE INDEX IF NOT EXISTS customer_access_tokens_expiry_idx
    ON customer_access_tokens (expires_at)
    WHERE revoked_at IS NULL;

-- 3. Customer sessions (HttpOnly cookie transport) -------------------------
CREATE TABLE IF NOT EXISTS customer_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    session_hash VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_sessions_conversation_idx
    ON customer_sessions (conversation_id);

CREATE INDEX IF NOT EXISTS customer_sessions_expiry_idx
    ON customer_sessions (expires_at)
    WHERE revoked_at IS NULL;
