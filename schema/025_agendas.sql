-- Meeting agendas: officers plan a meeting ahead of time and run it from the
-- same page. An agenda belongs to a meeting record, so the attendance taken at
-- that meeting sits with its agenda.
--
-- The fixed checklist steps (call to order, pledge, minutes approved, ...) are
-- listed in src/lib/agenda.js. Every field is saved on its own, so officers
-- filling in different parts at the same time do not overwrite each other.

CREATE TABLE agendas (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id            INTEGER NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
  location              TEXT,
  start_time            TEXT,     -- planned, HH:MM
  called_to_order       TEXT,     -- actual, HH:MM
  adjourned_at          TEXT,     -- actual, HH:MM
  presiding             TEXT,
  secretary             TEXT,
  quorum                INTEGER,  -- NULL not yet checked, 1 yes, 0 no
  pledge_by             TEXT,
  prayer_by             TEXT,
  minutes_corrections   TEXT,
  treasurer_begin       TEXT,     -- balances as the treasurer gives them; the bank is not tracked here
  treasurer_end         TEXT,
  discussion_notes      TEXT,
  recess_moved          TEXT,
  presentation_title    TEXT,
  presenter_name        TEXT,
  presenter_affiliation TEXT,
  presenter_contact     TEXT,
  presentation_length   TEXT,
  presentation_intro    TEXT,
  presentation_notes    TEXT,
  next_meeting_date     TEXT,
  next_meeting_place    TEXT,
  next_presenter        TEXT,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Checklist steps ticked off during the meeting, one row per ticked step
CREATE TABLE agenda_checks (
  agenda_id   INTEGER NOT NULL REFERENCES agendas(id) ON DELETE CASCADE,
  step        TEXT    NOT NULL,
  checked_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  checked_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agenda_id, step)
);

-- One officer report per position (or 'committee' for committee/other reports)
CREATE TABLE agenda_reports (
  agenda_id   INTEGER NOT NULL REFERENCES agendas(id) ON DELETE CASCADE,
  report_key  TEXT    NOT NULL,
  body        TEXT,
  given       INTEGER NOT NULL DEFAULT 0,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agenda_id, report_key)
);

-- Old business, new business, and announcements. Old and new business still
-- 'open' when the next agenda of the same meeting type is started are copied
-- into its old business; carried_from_id points at the item copied.
CREATE TABLE agenda_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agenda_id       INTEGER NOT NULL REFERENCES agendas(id) ON DELETE CASCADE,
  section         TEXT    NOT NULL CHECK (section IN ('old', 'new', 'announcement')),
  title           TEXT    NOT NULL,
  details         TEXT,
  owner           TEXT,   -- who is bringing it
  status          TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'tabled')),
  carried_from_id INTEGER REFERENCES agenda_items(id) ON DELETE SET NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Motions and votes, in the order they were made
CREATE TABLE agenda_motions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agenda_id     INTEGER NOT NULL REFERENCES agendas(id) ON DELETE CASCADE,
  motion        TEXT    NOT NULL,
  moved_by      TEXT,
  seconded_by   TEXT,
  votes_yes     INTEGER,
  votes_no      INTEGER,
  votes_abstain INTEGER,
  result        TEXT    CHECK (result IN ('passed', 'failed', 'tabled', 'withdrawn')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_agenda_items_agenda   ON agenda_items(agenda_id);
CREATE INDEX idx_agenda_items_carried  ON agenda_items(carried_from_id);
CREATE INDEX idx_agenda_motions_agenda ON agenda_motions(agenda_id);
