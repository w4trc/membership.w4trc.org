-- Site notes and photos can belong to the whole repeater site instead of one
-- repeater: repeater_id NULL means the site, shown with every repeater.
-- SQLite cannot drop NOT NULL in place, so both tables are rebuilt.

CREATE TABLE repeater_notes_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repeater_id  INTEGER REFERENCES repeaters(id) ON DELETE CASCADE,  -- NULL: the whole site
  note         TEXT    NOT NULL,
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO repeater_notes_new (id, repeater_id, note, pinned, created_by, created_at, updated_at)
  SELECT id, repeater_id, note, pinned, created_by, created_at, updated_at FROM repeater_notes;
DROP TABLE repeater_notes;
ALTER TABLE repeater_notes_new RENAME TO repeater_notes;
CREATE INDEX idx_repeater_notes_rpt ON repeater_notes(repeater_id);

CREATE TABLE repeater_photos_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repeater_id  INTEGER REFERENCES repeaters(id) ON DELETE CASCADE,  -- NULL: the whole site
  caption      TEXT,
  taken_date   TEXT,
  image        BLOB    NOT NULL,
  thumb        BLOB    NOT NULL,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO repeater_photos_new (id, repeater_id, caption, taken_date, image, thumb, created_by, created_at)
  SELECT id, repeater_id, caption, taken_date, image, thumb, created_by, created_at FROM repeater_photos;
DROP TABLE repeater_photos;
ALTER TABLE repeater_photos_new RENAME TO repeater_photos;
CREATE INDEX idx_repeater_photos_rpt ON repeater_photos(repeater_id);
