-- Migration 006: Add Silent Key status for deceased members
-- "Silent Key" (SK) is the amateur radio tradition for a deceased operator.

ALTER TABLE members ADD COLUMN is_silent_key INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_members_is_silent_key ON members(is_silent_key);
