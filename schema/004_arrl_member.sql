-- Migration 004: ARRL membership tracking
-- Tracks whether a member holds an ARRL membership, required for club reporting

ALTER TABLE members ADD COLUMN is_arrl_member INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_members_arrl ON members(is_arrl_member);
