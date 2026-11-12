-- Site visits belong to the whole repeater site, not one repeater: a trip to
-- the site is one visit, whichever machines were worked on. Existing visits
-- move to the site (repeater_id NULL), and new ones are always logged there.
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt.

CREATE TABLE repeater_visits_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repeater_id  INTEGER REFERENCES repeaters(id) ON DELETE CASCADE,  -- always NULL: the whole site
  visit_date   TEXT    NOT NULL,              -- YYYY-MM-DD
  time_in      TEXT,                          -- HH:MM
  time_out     TEXT,                          -- HH:MM
  visitors     TEXT    NOT NULL,              -- names or callsigns
  purpose      TEXT    NOT NULL,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO repeater_visits_new (id, repeater_id, visit_date, time_in, time_out, visitors, purpose, notes, created_by, created_at, updated_at)
  SELECT id, NULL, visit_date, time_in, time_out, visitors, purpose, notes, created_by, created_at, updated_at FROM repeater_visits;
DROP TABLE repeater_visits;
ALTER TABLE repeater_visits_new RENAME TO repeater_visits;
CREATE INDEX idx_repeater_visits_date ON repeater_visits(visit_date);
