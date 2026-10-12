-- Google Groups sync: which addresses the sync has placed in each year's group.
--
-- added_by_sync = 1  the sync added this address, so it may remove it again
-- added_by_sync = 0  the address was already in the group (added by hand in
--                    Google); the sync tracks it but never removes it

CREATE TABLE google_group_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  year          INTEGER NOT NULL,
  email         TEXT    NOT NULL COLLATE NOCASE,
  member_id     INTEGER REFERENCES members(id) ON DELETE SET NULL,
  added_by_sync INTEGER NOT NULL DEFAULT 1,
  added_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(year, email)
);
