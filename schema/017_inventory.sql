-- Club equipment inventory: items, where they are, and a history of every move and note

-- Places an item can be stored. Deactivate rather than delete so history keeps its names.
CREATE TABLE inventory_locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO inventory_locations (name, sort_order) VALUES
  ('Eastman Storage', 1),
  ('Tower',           2),
  ('Joshua''s House', 3),
  ('Neil''s House',   4);

-- An item is either at a location or checked out to a member, never both.
-- location_since is the date (YYYY-MM-DD) of its most recent move.
CREATE TABLE inventory_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  manufacturer        TEXT,
  model               TEXT,
  serial_number       TEXT,
  location_id         INTEGER REFERENCES inventory_locations(id),
  assigned_member_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
  location_since      TEXT,
  photo_updated_at    TEXT,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (location_id IS NULL OR assigned_member_id IS NULL)
);

-- Photos live in their own table so item queries never drag the image bytes along.
-- Both are JPEGs resized in the browser before upload (D1 caps a row at 2 MB).
CREATE TABLE inventory_photos (
  item_id     INTEGER PRIMARY KEY REFERENCES inventory_items(id) ON DELETE CASCADE,
  image       BLOB    NOT NULL,
  thumb       BLOB    NOT NULL,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per thing that happened to an item. 'added', 'moved' and 'checked_out'
-- record where it came from and went to; 'note' is a dated note with no movement.
-- event_date is the date it happened (YYYY-MM-DD), which may be backdated.
CREATE TABLE inventory_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id           INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  event_type        TEXT    NOT NULL CHECK (event_type IN ('added', 'moved', 'checked_out', 'note')),
  event_date        TEXT    NOT NULL,
  from_location_id  INTEGER REFERENCES inventory_locations(id),
  from_member_id    INTEGER REFERENCES members(id) ON DELETE SET NULL,
  to_location_id    INTEGER REFERENCES inventory_locations(id),
  to_member_id      INTEGER REFERENCES members(id) ON DELETE SET NULL,
  note              TEXT,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_inventory_items_location ON inventory_items(location_id);
CREATE INDEX idx_inventory_items_member   ON inventory_items(assigned_member_id);
CREATE INDEX idx_inventory_events_item    ON inventory_events(item_id, event_date);
