-- KARC Membership System - Seed Data
-- Run AFTER 001_initial.sql
-- 
-- Creates the initial admin member record for N4JHC
-- and the admin login account.
--
-- IMPORTANT: After first login, immediately change your password
-- via the admin panel. The default password is: KARCadmin2024!

-- Insert N4JHC as a member record first
INSERT OR IGNORE INTO members (
  callsign, first_name, last_name,
  membership_type, joined_date, is_active
) VALUES (
  'N4JHC', 'Admin', 'N4JHC',
  'individual', date('now'), 1
);

-- Insert the admin user account
-- Default password hash is for: KARCadmin2024!
-- Generated with bcrypt cost=12
-- CHANGE THIS IMMEDIATELY after first login!
INSERT OR IGNORE INTO users (
  email, password_hash, role, member_id
) VALUES (
  'admin@w4trc.org',
  '$2b$12$placeholder_change_via_setup_script',
  'admin',
  (SELECT id FROM members WHERE callsign = 'N4JHC')
);
