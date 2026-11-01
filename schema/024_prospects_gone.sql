-- Local hams the FCC says are no longer here: set by the FCC catch-up and
-- the daily check, cleared when they show up active in the area again.
ALTER TABLE prospects ADD COLUMN fcc_gone    TEXT;  -- moved | expired | cancelled
ALTER TABLE prospects ADD COLUMN fcc_gone_at TEXT;  -- when it was first noticed

CREATE INDEX IF NOT EXISTS idx_prospects_fcc_gone ON prospects(fcc_gone);
