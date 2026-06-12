-- Donation tracking: monetary or item donations from members, organizations, or anonymous donors
CREATE TABLE donations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_type        TEXT    NOT NULL DEFAULT 'member'
                    CHECK (donor_type IN ('member', 'organization', 'anonymous')),
  member_id         INTEGER REFERENCES members(id) ON DELETE SET NULL,
  organization_name TEXT,
  donation_kind     TEXT    NOT NULL DEFAULT 'monetary'
                    CHECK (donation_kind IN ('monetary', 'item')),
  amount            REAL,
  item_description  TEXT,
  estimated_value   REAL,
  donation_date     TEXT    NOT NULL,
  payment_method    TEXT    CHECK (payment_method IN ('cash', 'check', 'paypal', 'stripe', 'other')),
  check_number      TEXT,
  notes             TEXT,
  recorded_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_donations_member_id   ON donations(member_id);
CREATE INDEX idx_donations_date        ON donations(donation_date);
CREATE INDEX idx_donations_donor_type  ON donations(donor_type);
CREATE INDEX idx_donations_kind        ON donations(donation_kind);
