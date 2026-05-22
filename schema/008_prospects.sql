-- Local Hams prospect tracking table
-- Stores area hams (FCC ULS data) for membership outreach

CREATE TABLE IF NOT EXISTS prospects (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  callsign            TEXT    UNIQUE NOT NULL,
  first_name          TEXT,
  last_name           TEXT,
  city                TEXT,
  state               TEXT,
  zip                 TEXT,
  email               TEXT,
  outreach_status     TEXT    NOT NULL DEFAULT 'not_contacted',
  postcard_sent       INTEGER NOT NULL DEFAULT 0,
  postcard_sent_date  TEXT,
  notes               TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prospects_callsign       ON prospects(callsign);
CREATE INDEX IF NOT EXISTS idx_prospects_outreach_status ON prospects(outreach_status);
CREATE INDEX IF NOT EXISTS idx_prospects_city           ON prospects(city);
CREATE INDEX IF NOT EXISTS idx_prospects_postcard_sent  ON prospects(postcard_sent);
