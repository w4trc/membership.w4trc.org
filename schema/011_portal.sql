-- Phase 3: Member portal + self-registration
-- Run: wrangler d1 execute karc-membership --file=schema/011_portal.sql

-- Directory opt-in flag on member records
ALTER TABLE members ADD COLUMN show_in_directory INTEGER NOT NULL DEFAULT 0;

-- Email verification tokens for portal registration / account claim
CREATE TABLE IF NOT EXISTS portal_tokens (
  id         TEXT    PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  email      TEXT    NOT NULL,
  code_hash  TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_portal_tokens_member  ON portal_tokens(member_id);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_expires ON portal_tokens(expires_at);
