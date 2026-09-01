-- Allow one Gmail to hold both a farmer and a student account.
-- Run: psql -U postgres -d agrilearn -f migrate-dual-role.sql

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_role_uidx
  ON users (lower(email), COALESCE(role, 'pending'));
