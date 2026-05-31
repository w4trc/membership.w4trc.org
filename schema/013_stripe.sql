-- Migration 013: Stripe payment support
-- Adds 'stripe' to payment_method CHECK constraint and stripe_session_id column.
-- SQLite cannot ALTER a CHECK constraint, so this rebuilds the memberships table.

PRAGMA foreign_keys = OFF;

CREATE TABLE memberships_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id            INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  year                 INTEGER NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'expired', 'honorary', 'pending', 'waived')),
  membership_type      TEXT    NOT NULL DEFAULT 'individual'
                               CHECK (membership_type IN ('individual', 'family')),
  amount_due           REAL    NOT NULL DEFAULT 20.00,
  amount_paid          REAL,
  paid_date            TEXT,
  payment_method       TEXT    CHECK (payment_method IN ('cash', 'check', 'paypal', 'stripe', 'other', NULL)),
  check_number         TEXT,
  notes                TEXT,
  stripe_session_id    TEXT    UNIQUE,
  covered_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  recorded_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member_id, year)
);

INSERT INTO memberships_new
  (id, member_id, year, status, membership_type, amount_due, amount_paid, paid_date,
   payment_method, check_number, notes, stripe_session_id, covered_by_member_id, recorded_by, created_at, updated_at)
SELECT
  id, member_id, year, status, membership_type, amount_due, amount_paid, paid_date,
  payment_method, check_number, notes, NULL, covered_by_member_id, recorded_by, created_at, updated_at
FROM memberships;

DROP TABLE memberships;

ALTER TABLE memberships_new RENAME TO memberships;

CREATE INDEX IF NOT EXISTS idx_memberships_member_id  ON memberships(member_id);
CREATE INDEX IF NOT EXISTS idx_memberships_year       ON memberships(year);
CREATE INDEX IF NOT EXISTS idx_memberships_covered_by ON memberships(covered_by_member_id);

PRAGMA foreign_keys = ON;
