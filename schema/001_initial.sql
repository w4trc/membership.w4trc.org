-- KARC Membership System - Initial Schema
-- Kingsport Amateur Radio Club (W4TRC)

-- ============================================================
-- USERS (login accounts, separate from member records)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT  NOT NULL,
  role        TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'board', 'member')),
  member_id   INTEGER REFERENCES members(id) ON DELETE SET NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login  TEXT
);

-- ============================================================
-- MEMBERS (core member records)
-- ============================================================
CREATE TABLE IF NOT EXISTS members (
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

  -- From FCC/HamDB API (auto-filled, periodically refreshed)
  license_class   TEXT    CHECK (license_class IN ('Technician', 'General', 'Amateur Extra', 'Novice', 'Advanced', NULL)),
  license_expiry  TEXT,   -- ISO date
  license_status  TEXT,   -- 'A' active, 'E' expired, etc.
  hamdb_synced_at TEXT,   -- last time we pulled from HamDB

  -- Member metadata
  membership_type TEXT    NOT NULL DEFAULT 'individual' CHECK (membership_type IN ('individual', 'family')),
  joined_date     TEXT,   -- ISO date, first ever joined
  is_active       INTEGER NOT NULL DEFAULT 1,

  -- Profile (for later member portal)
  bio             TEXT,
  interests       TEXT,   -- comma-separated or JSON array
  photo_url       TEXT,

  -- Emergency contact
  emergency_name  TEXT,
  emergency_phone TEXT,

  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_members_callsign  ON members(callsign);
CREATE INDEX IF NOT EXISTS idx_members_last_name ON members(last_name);
CREATE INDEX IF NOT EXISTS idx_members_is_active ON members(is_active);

-- ============================================================
-- MEMBERSHIPS (annual dues tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS memberships (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id       INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  year            INTEGER NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'expired', 'honorary', 'pending', 'waived')),
  membership_type TEXT    NOT NULL DEFAULT 'individual'
                          CHECK (membership_type IN ('individual', 'family')),
  amount_due      REAL    NOT NULL DEFAULT 20.00,
  amount_paid     REAL,
  paid_date       TEXT,   -- ISO date
  payment_method  TEXT    CHECK (payment_method IN ('cash', 'check', 'paypal', 'other', NULL)),
  check_number    TEXT,
  notes           TEXT,
  recorded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),

  UNIQUE(member_id, year)
);

CREATE INDEX IF NOT EXISTS idx_memberships_member_id ON memberships(member_id);
CREATE INDEX IF NOT EXISTS idx_memberships_year      ON memberships(year);

-- ============================================================
-- NOTES (admin/board log entries on members)
-- ============================================================
CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note_text   TEXT    NOT NULL,
  is_private  INTEGER NOT NULL DEFAULT 1, -- 1 = admin/board only
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_member_id ON notes(member_id);

-- ============================================================
-- AUDIT LOG (security trail for every significant action)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,  -- e.g. 'member.create', 'member.delete', 'login.success'
  target_type TEXT,              -- 'member', 'membership', 'user', 'note'
  target_id   INTEGER,
  detail      TEXT,              -- JSON blob with before/after or extra context
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target     ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- ============================================================
-- SESSIONS (server-side session store)
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,  -- UUID
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address  TEXT,
  user_agent  TEXT,
  expires_at  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ============================================================
-- SEED: Initial admin user (N4JHC)
-- Password: ChangeMe2024! (bcrypt hash generated separately)
-- Run: wrangler d1 execute karc-membership --file=schema/002_seed.sql
-- ============================================================
