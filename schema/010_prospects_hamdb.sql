-- Add street address and HamDB sync tracking to prospects
ALTER TABLE prospects ADD COLUMN address         TEXT;
ALTER TABLE prospects ADD COLUMN license_class   TEXT;
ALTER TABLE prospects ADD COLUMN license_expiry  TEXT;
ALTER TABLE prospects ADD COLUMN license_status  TEXT;
ALTER TABLE prospects ADD COLUMN hamdb_synced_at TEXT;
