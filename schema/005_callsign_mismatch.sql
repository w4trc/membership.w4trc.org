-- Migration 005: Callsign mismatch detection
-- Flags when HamDB returns a different person for a stored callsign,
-- indicating the callsign may have been reassigned by the FCC

ALTER TABLE members ADD COLUMN callsign_mismatch  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN hamdb_mismatch_data TEXT;  -- JSON blob of what HamDB returned

CREATE INDEX IF NOT EXISTS idx_members_mismatch ON members(callsign_mismatch);
