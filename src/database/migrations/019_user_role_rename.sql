-- 019_user_role_rename.sql (Phase 21 – ADMIN / USER role model)
-- Additive only. No old migration is edited; no existing data is destroyed.
--
-- Phase 20 introduced the internal role column with values ADMIN/OPERATOR.
-- The product model names the standard internal role USER, so this
-- migration renames the value (existing OPERATOR rows become USER with
-- identical permissions) and narrows the CHECK to ADMIN/USER. There is
-- deliberately still NO customer role: customers are external
-- leads/conversations, never rows in users.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users SET role = 'USER' WHERE role = 'OPERATOR';

ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN', 'USER'));

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'USER';
