-- 017_user_auth_and_conversation_ownership.sql (Phase 11 – Real backend authentication)
-- Additive only. No old migration is edited; no existing data is destroyed.
--
-- Users: minimal first-party identity (email + bcrypt password hash).
-- Sessions: opaque refresh tokens (SHA-256 hash stored; HttpOnly cookie
-- transport) with revocation support for logout.
-- Conversations: nullable user_id anchor. Existing rows keep user_id NULL
-- and are ISOLATED (owner-scoped queries never match NULL): they are not
-- silently assigned to any user. Leads stay global in this single-company
-- application (documented in docs/authentication.md).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    last_login_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx
    ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx
    ON user_sessions (user_id);

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversations_user_id_idx
    ON conversations (user_id) WHERE user_id IS NOT NULL;
