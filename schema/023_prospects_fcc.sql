-- New local licensees added automatically from the FCC's daily license files
ALTER TABLE prospects ADD COLUMN source          TEXT;  -- 'fcc' when added by the daily check
ALTER TABLE prospects ADD COLUMN added_reason    TEXT;  -- new_license | new_callsign | new_to_list
ALTER TABLE prospects ADD COLUMN license_granted TEXT;  -- YYYY-MM-DD, from the FCC grant date
ALTER TABLE prospects ADD COLUMN auto_added_at   TEXT;  -- when the daily check added it

CREATE INDEX IF NOT EXISTS idx_prospects_auto_added_at ON prospects(auto_added_at);

-- One row per FCC daily file (l_am_mon.zip ... l_am_sun.zip). The FCC
-- replaces each file weekly, so last_modified tells us when it is new.
CREATE TABLE IF NOT EXISTS fcc_daily_imports (
  file          TEXT PRIMARY KEY,
  last_modified TEXT,
  checked_at    TEXT NOT NULL DEFAULT (datetime('now')),
  matched       INTEGER NOT NULL DEFAULT 0,
  added         INTEGER NOT NULL DEFAULT 0,
  updated       INTEGER NOT NULL DEFAULT 0
);
