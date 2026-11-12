-- People to call about the repeaters: site owner, landowner, tower crew,
-- trustee. repeater_id NULL means the contact is for the whole site.
CREATE TABLE repeater_contacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repeater_id  INTEGER REFERENCES repeaters(id) ON DELETE CASCADE,  -- NULL: the whole site
  name         TEXT    NOT NULL,
  title        TEXT,                -- role, e.g. "Landowner", "Tower climber", "Trustee"
  phone        TEXT,
  email        TEXT,
  has_key      INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_repeater_contacts_rpt ON repeater_contacts(repeater_id);
