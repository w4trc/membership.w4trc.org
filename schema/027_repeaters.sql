-- Club repeaters (officers only): the basic listing for each machine, plus
-- site visits, reports of trouble on the air, maintenance and listing
-- renewals, site notes, photos, and manuals.
--
-- Photos are JPEGs resized in the browser and kept in D1 like inventory
-- photos (D1 caps a row at 2 MB). Uploaded manuals and other files are too
-- big for that, so they live in R2 under repeaters/ in BACKUP_BUCKET; a
-- document can instead be a link to a manufacturer's page.

CREATE TABLE repeaters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,             -- what officers call it, e.g. "2m Bays Mountain"
  callsign      TEXT,
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'testing', 'offline', 'planned', 'retired')),
  band          TEXT,                         -- 2m, 70cm, 6m, ...
  mode          TEXT,                         -- FM, DMR, Fusion, D-STAR, P25, ...
  output_freq   TEXT,                         -- MHz as officers write it, e.g. 146.970 (what radios listen to)
  input_freq    TEXT,                         -- MHz, what radios transmit on
  tone_in       TEXT,                         -- access tone users send: CTCSS (88.5) or DCS (D023)
  tone_out      TEXT,                         -- tone the repeater sends, if any
  digital_info  TEXT,                         -- color code, NAC, DG-ID, talkgroups, ...
  screen_pin    TEXT,                         -- front-panel / controller PIN
  equipment     TEXT,                         -- repeater, controller, duplexer
  antenna       TEXT,                         -- antenna, height, feedline
  power         TEXT,                         -- output power, e.g. "50 W"
  site_name     TEXT,
  site_address  TEXT,                         -- address or coordinates
  site_access   TEXT,                         -- directions, keys, gate codes, who to call
  notes         TEXT,                         -- anything else about the listing
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Who went to the site, when, and why
CREATE TABLE repeater_visits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repeater_id  INTEGER NOT NULL REFERENCES repeaters(id) ON DELETE CASCADE,
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

-- Trouble reported on the repeater: noise, interference, unlicensed use, outages
CREATE TABLE repeater_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repeater_id   INTEGER NOT NULL REFERENCES repeaters(id) ON DELETE CASCADE,
  report_date   TEXT    NOT NULL,             -- YYYY-MM-DD it happened or was reported
  category      TEXT    NOT NULL CHECK (category IN ('noise', 'interference', 'unlicensed', 'kerchunking', 'conduct', 'outage', 'audio', 'coverage', 'other')),
  reported_by   TEXT,
  description   TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved')),
  resolution    TEXT,
  resolved_date TEXT,                         -- YYYY-MM-DD
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Maintenance done and paperwork kept up: coordination listings, licenses,
-- site lease, insurance. next_due on the latest entry of a kind and title is
-- when it next needs doing; earlier entries are history.
CREATE TABLE repeater_maintenance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repeater_id  INTEGER NOT NULL REFERENCES repeaters(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL CHECK (kind IN ('maintenance', 'repair', 'upgrade', 'inspection', 'listing', 'coordination', 'license', 'lease', 'insurance', 'other')),
  title        TEXT    NOT NULL,              -- e.g. "RepeaterBook listing", "Duplexer retune"
  done_date    TEXT,                          -- YYYY-MM-DD; NULL for something only scheduled
  next_due     TEXT,                          -- YYYY-MM-DD
  done_by      TEXT,
  cost         REAL,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- General notes about the site
CREATE TABLE repeater_notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repeater_id  INTEGER NOT NULL REFERENCES repeaters(id) ON DELETE CASCADE,
  note         TEXT    NOT NULL,
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Site photos. Listing queries leave out the image columns.
CREATE TABLE repeater_photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repeater_id  INTEGER NOT NULL REFERENCES repeaters(id) ON DELETE CASCADE,
  caption      TEXT,
  taken_date   TEXT,                          -- YYYY-MM-DD
  image        BLOB    NOT NULL,
  thumb        BLOB    NOT NULL,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Manuals and other files: an uploaded file in R2 (r2_key) or a link (url)
CREATE TABLE repeater_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repeater_id   INTEGER NOT NULL REFERENCES repeaters(id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,
  kind          TEXT    NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'programming', 'license', 'agreement', 'diagram', 'other')),
  url           TEXT,
  r2_key        TEXT,
  filename      TEXT,
  content_type  TEXT,
  size          INTEGER,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK ((url IS NULL) <> (r2_key IS NULL))
);

CREATE INDEX idx_repeater_visits_rpt      ON repeater_visits(repeater_id, visit_date);
CREATE INDEX idx_repeater_reports_rpt     ON repeater_reports(repeater_id, report_date);
CREATE INDEX idx_repeater_reports_status  ON repeater_reports(status);
CREATE INDEX idx_repeater_maintenance_rpt ON repeater_maintenance(repeater_id, kind);
CREATE INDEX idx_repeater_notes_rpt       ON repeater_notes(repeater_id);
CREATE INDEX idx_repeater_photos_rpt      ON repeater_photos(repeater_id);
CREATE INDEX idx_repeater_documents_rpt   ON repeater_documents(repeater_id);
