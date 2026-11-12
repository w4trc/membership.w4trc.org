-- KARC Membership System - Seed Data
-- Sample data for LOCAL DEV ONLY. Run after the migrations: npm run db:seed:local
-- Never run this against the production database: the logins below share a
-- password that is written right here.
--
-- Three logins, one per kind of user, all with the password: KARCadmin2024!
--   dev-admin@example.com   admin, with a member record (lands on the portal, can open the admin section)
--   dev-board@example.com   board, no member record     (lands on the admin section)
--   dev-member@example.com  member                      (portal only)
--
-- Plus a few members, a dues payment, a meeting with an agenda, an inventory
-- item, and a repeater with something coming due, so every page has a record
-- to open. Safe to run more than once.

-- ── Members ────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO members (callsign, first_name, last_name, email, city, state, license_class, membership_type, joined_date, is_active) VALUES
  ('W4DEV', 'Dana',  'Developer', 'dev-admin@example.com',  'Kingsport', 'TN', 'Amateur Extra', 'individual', date('now', '-3 years'), 1),
  ('W4AAA', 'Alex',  'Able',      'dev-member@example.com', 'Kingsport', 'TN', 'General',       'individual', date('now', '-2 years'), 1),
  ('W4BBB', 'Blair', 'Baker',     'blair@example.com',      'Gray',      'TN', 'Technician',    'family',     date('now', '-1 years'), 1),
  ('W4CCC', 'Casey', 'Charlie',   NULL,                     'Bristol',   'TN', 'Technician',    'individual', date('now', '-4 years'), 0);

-- ── Logins (PBKDF2 hash of the password above, as src/lib/auth.js makes them) ──
INSERT OR IGNORE INTO users (email, password_hash, role, member_id) VALUES
  ('dev-admin@example.com',
   'eyJzYWx0IjpbMTcyLDIwNSwyNDEsMjE1LDIwMCwxMjMsMTU4LDYsMTM4LDE1MiwyNDAsMTg2LDI1MywxNzQsMTM5LDcwXSwiaGFzaCI6WzE0NSw2MiwyMjYsMTE5LDI0OCwxMDIsMTAwLDEyOCwxNDIsNDksNzEsMTcxLDgyLDU4LDY3LDI4LDE3NSwxNDksMjQsMjQwLDU1LDI0LDE3NywzOCwyNDUsNDMsMjEzLDIzMSwyMzUsNjIsMTY5LDc0XSwiaXRlciI6MTAwMDAwfQ==',
   'admin', (SELECT id FROM members WHERE callsign = 'W4DEV')),
  ('dev-board@example.com',
   'eyJzYWx0IjpbMTcyLDIwNSwyNDEsMjE1LDIwMCwxMjMsMTU4LDYsMTM4LDE1MiwyNDAsMTg2LDI1MywxNzQsMTM5LDcwXSwiaGFzaCI6WzE0NSw2MiwyMjYsMTE5LDI0OCwxMDIsMTAwLDEyOCwxNDIsNDksNzEsMTcxLDgyLDU4LDY3LDI4LDE3NSwxNDksMjQsMjQwLDU1LDI0LDE3NywzOCwyNDUsNDMsMjEzLDIzMSwyMzUsNjIsMTY5LDc0XSwiaXRlciI6MTAwMDAwfQ==',
   'board', NULL),
  ('dev-member@example.com',
   'eyJzYWx0IjpbMTcyLDIwNSwyNDEsMjE1LDIwMCwxMjMsMTU4LDYsMTM4LDE1MiwyNDAsMTg2LDI1MywxNzQsMTM5LDcwXSwiaGFzaCI6WzE0NSw2MiwyMjYsMTE5LDI0OCwxMDIsMTAwLDEyOCwxNDIsNDksNzEsMTcxLDgyLDU4LDY3LDI4LDE3NSwxNDksMjQsMjQwLDU1LDI0LDE3NywzOCwyNDUsNDMsMjEzLDIzMSwyMzUsNjIsMTY5LDc0XSwiaXRlciI6MTAwMDAwfQ==',
   'member', (SELECT id FROM members WHERE callsign = 'W4AAA'));

-- ── Dues: two paid for this year, one not ──────────────────────────────
INSERT OR IGNORE INTO memberships (member_id, year, status, membership_type, amount_due, amount_paid, paid_date, payment_method)
SELECT id, CAST(strftime('%Y', 'now') AS INTEGER), 'active', membership_type, 20, 20, date('now', '-10 days'), 'check'
FROM members WHERE callsign IN ('W4DEV', 'W4BBB');

-- ── A meeting with attendance and an agenda ────────────────────────────
INSERT INTO meetings (meeting_type, meeting_date, title, notes)
SELECT 'monthly', date('now', '+14 days'), NULL, 'Sample meeting from the dev seed'
WHERE NOT EXISTS (SELECT 1 FROM meetings WHERE notes = 'Sample meeting from the dev seed');

INSERT OR IGNORE INTO meeting_attendees (meeting_id, member_id, callsign, name)
SELECT mt.id, m.id, m.callsign, m.first_name || ' ' || m.last_name
FROM meetings mt, members m
WHERE mt.notes = 'Sample meeting from the dev seed' AND m.callsign IN ('W4DEV', 'W4AAA');

INSERT OR IGNORE INTO agendas (meeting_id, location, start_time)
SELECT id, 'Clubhouse', '19:00' FROM meetings WHERE notes = 'Sample meeting from the dev seed';

-- ── An inventory item ──────────────────────────────────────────────────
INSERT INTO inventory_items (name, manufacturer, model, serial_number, location_id, location_since)
SELECT 'Field Day HF radio', 'Icom', 'IC-7300', 'DEV-0001', (SELECT id FROM inventory_locations ORDER BY sort_order, id LIMIT 1), date('now', '-30 days')
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE serial_number = 'DEV-0001');

-- ── A repeater with a renewal coming due ───────────────────────────────
INSERT INTO repeaters (name, callsign, band, mode, output_freq, input_freq, tone_in, site_name)
SELECT '2m Sample Mountain', 'W4TRC', '2m', 'FM', '146.970', '146.370', '123.0', 'Sample Mountain'
WHERE NOT EXISTS (SELECT 1 FROM repeaters WHERE name = '2m Sample Mountain');

INSERT INTO repeater_maintenance (repeater_id, kind, title, done_date, next_due)
SELECT id, 'listing', 'RepeaterBook listing', date('now', '-350 days'), date('now', '+15 days')
FROM repeaters r WHERE r.name = '2m Sample Mountain'
  AND NOT EXISTS (SELECT 1 FROM repeater_maintenance x WHERE x.repeater_id = r.id);
