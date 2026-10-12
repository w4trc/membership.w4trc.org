-- Public donate page: donations from people who are not members.
-- Adds the 'individual' donor type plus donor_name / donor_email.
-- SQLite cannot ALTER a CHECK constraint, so this rebuilds the donations table.
-- No other table references donations, so the rebuild needs no foreign key handling.

CREATE TABLE donations_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_type        TEXT    NOT NULL DEFAULT 'member'
                    CHECK (donor_type IN ('member', 'individual', 'organization', 'anonymous')),
  member_id         INTEGER REFERENCES members(id) ON DELETE SET NULL,
  organization_name TEXT,
  donor_name        TEXT,
  donor_email       TEXT,
  donation_kind     TEXT    NOT NULL DEFAULT 'monetary'
                    CHECK (donation_kind IN ('monetary', 'item')),
  amount            REAL,
  item_description  TEXT,
  estimated_value   REAL,
  donation_date     TEXT    NOT NULL,
  payment_method    TEXT    CHECK (payment_method IN ('cash', 'check', 'paypal', 'stripe', 'other')),
  check_number      TEXT,
  notes             TEXT,
  stripe_session_id TEXT,
  recorded_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO donations_new
  (id, donor_type, member_id, organization_name, donation_kind, amount, item_description, estimated_value,
   donation_date, payment_method, check_number, notes, stripe_session_id, recorded_by, created_at, updated_at)
SELECT
  id, donor_type, member_id, organization_name, donation_kind, amount, item_description, estimated_value,
  donation_date, payment_method, check_number, notes, stripe_session_id, recorded_by, created_at, updated_at
FROM donations;

DROP TABLE donations;

ALTER TABLE donations_new RENAME TO donations;

CREATE INDEX idx_donations_member_id   ON donations(member_id);
CREATE INDEX idx_donations_date        ON donations(donation_date);
CREATE INDEX idx_donations_donor_type  ON donations(donor_type);
CREATE INDEX idx_donations_kind        ON donations(donation_kind);

CREATE UNIQUE INDEX idx_donations_stripe_session ON donations(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
