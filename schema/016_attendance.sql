-- Meeting attendance: club meetings and who attended (members, visiting hams, non-ham guests)
CREATE TABLE meetings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_type  TEXT    NOT NULL DEFAULT 'monthly'
                CHECK (meeting_type IN ('monthly', 'board', 've_session', 'field_day', 'special', 'other')),
  meeting_date  TEXT    NOT NULL,
  title         TEXT,
  notes         TEXT,
  recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per attendee. Hams have a callsign (and member_id if they are a club
-- member); non-ham guests have only a name. Name is a snapshot at entry time.
CREATE TABLE meeting_attendees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_id   INTEGER REFERENCES members(id) ON DELETE SET NULL,
  callsign    TEXT    COLLATE NOCASE,
  name        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_meetings_date             ON meetings(meeting_date);
CREATE INDEX idx_meeting_attendees_meeting ON meeting_attendees(meeting_id);
CREATE INDEX idx_meeting_attendees_member  ON meeting_attendees(member_id);
CREATE UNIQUE INDEX idx_meeting_attendees_callsign ON meeting_attendees(meeting_id, callsign) WHERE callsign IS NOT NULL;
