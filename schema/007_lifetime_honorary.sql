-- Migration 007: Lifetime honorary membership type
-- Lifetime honorary members (e.g. tower owner, club benefactors) are always
-- considered active members and never pay dues. They are protected from the
-- annual membership cutoff tool.

-- SQLite does not support ALTER TABLE ... MODIFY CONSTRAINT, so we recreate
-- the members table with 'lifetime_honorary' added to the membership_type CHECK.

CREATE TABLE members_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  callsign        TEXT    UNIQUE COLLATE NOCASE,
  first_name      TEXT    NOT NULL,
  last_name       TEXT    NOT NULL,
  email           TEXT    COLLATE NOCASE,
  phone           TEXT,
  address         TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,

  license_class   TEXT    CHECK (license_class IN ('Technician', 'General', 'Amateur Extra', 'Novice', 'Advanced', NULL)),
  license_expiry  TEXT,
  license_status  TEXT,
  hamdb_synced_at TEXT,

  membership_type TEXT    NOT NULL DEFAULT 'individual'
                          CHECK (membership_type IN ('individual', 'family', 'lifetime_honorary')),
  joined_date     TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,

  bio             TEXT,
  interests       TEXT,
  photo_url       TEXT,

  emergency_name  TEXT,
  emergency_phone TEXT,

  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),

  -- Added by migration 004
  is_arrl_member  INTEGER NOT NULL DEFAULT 0,

  -- Added by migration 005
  callsign_mismatch   INTEGER NOT NULL DEFAULT 0,
  hamdb_mismatch_data TEXT,

  -- Added by migration 006
  is_silent_key   INTEGER NOT NULL DEFAULT 0
);

INSERT INTO members_new (
  id, callsign, first_name, last_name, email, phone, address, city, state, zip,
  license_class, license_expiry, license_status, hamdb_synced_at,
  membership_type, joined_date, is_active,
  bio, interests, photo_url,
  emergency_name, emergency_phone,
  created_at, updated_at,
  is_arrl_member, callsign_mismatch, hamdb_mismatch_data, is_silent_key
)
SELECT
  id, callsign, first_name, last_name, email, phone, address, city, state, zip,
  license_class, license_expiry, license_status, hamdb_synced_at,
  membership_type, joined_date, is_active,
  bio, interests, photo_url,
  emergency_name, emergency_phone,
  created_at, updated_at,
  is_arrl_member, callsign_mismatch, hamdb_mismatch_data, is_silent_key
FROM members;

DROP TABLE members;
ALTER TABLE members_new RENAME TO members;

-- Recreate all indexes from migrations 001, 004, 005, 006
CREATE INDEX IF NOT EXISTS idx_members_callsign      ON members(callsign);
CREATE INDEX IF NOT EXISTS idx_members_last_name     ON members(last_name);
CREATE INDEX IF NOT EXISTS idx_members_is_active     ON members(is_active);
CREATE INDEX IF NOT EXISTS idx_members_arrl          ON members(is_arrl_member);
CREATE INDEX IF NOT EXISTS idx_members_mismatch      ON members(callsign_mismatch);
CREATE INDEX IF NOT EXISTS idx_members_is_silent_key ON members(is_silent_key);
