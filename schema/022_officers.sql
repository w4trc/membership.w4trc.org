-- Officer history: who held which position in which year.
--
-- One row per person, position and year. Nothing requires a full slate: early
-- years may have only a president, and a position nobody remembers is simply
-- left out. Officers from before the membership list was kept are stored by
-- name; member_id is filled in when the callsign matches a member record.
-- The positions themselves are listed in src/lib/officers.js.

CREATE TABLE officers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  year        INTEGER NOT NULL,
  position    TEXT    NOT NULL,
  name        TEXT    NOT NULL COLLATE NOCASE,
  callsign    TEXT    COLLATE NOCASE,
  member_id   INTEGER REFERENCES members(id) ON DELETE SET NULL,
  notes       TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(year, position, name)
);

CREATE INDEX idx_officers_year      ON officers(year);
CREATE INDEX idx_officers_member_id ON officers(member_id);
