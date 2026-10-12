-- One-time baseline for databases set up before migrations were tracked.
--
-- Migrations 001–019 used to be applied by hand with `wrangler d1 execute`, so
-- nothing recorded them. This marks them as applied in the table that
-- `wrangler d1 migrations` reads, without running any of them again.
--
-- ONLY run this against a database that already has every migration through
-- 019 applied. A new database does not need it — `npm run db:migrate` builds
-- one from scratch.
--
-- Prod:   npm run db:baseline
-- Local:  npm run db:baseline:local
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS d1_migrations(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('001_initial.sql'),
  ('003_family_linking.sql'),
  ('004_arrl_member.sql'),
  ('005_callsign_mismatch.sql'),
  ('006_silent_key.sql'),
  ('007_lifetime_honorary.sql'),
  ('008_prospects.sql'),
  ('010_prospects_hamdb.sql'),
  ('011_portal.sql'),
  ('012_password_reset.sql'),
  ('013_stripe.sql'),
  ('014_eastman_member.sql'),
  ('015_donations.sql'),
  ('016_attendance.sql'),
  ('017_inventory.sql'),
  ('018_inventory_purchase.sql'),
  ('019_donation_stripe.sql');
