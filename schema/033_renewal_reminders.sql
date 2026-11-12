-- Renewal reminder emails an officer has sent: one row per member per send,
-- so the reminders page can show who was last reminded and when.
CREATE TABLE IF NOT EXISTS renewal_reminders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  year       INTEGER NOT NULL,           -- the dues year the reminder was for
  email      TEXT    NOT NULL,           -- the address it went to
  sent_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sent_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_renewal_reminders_member ON renewal_reminders(member_id, year);
