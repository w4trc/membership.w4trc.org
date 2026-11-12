-- Two-step sign-in: a 6-digit code from an authenticator app (TOTP) after the
-- password. Off until a user turns it on for their own login.
--   totp_secret        the shared key, base32; set during setup, in use once totp_enabled = 1
--   totp_last_step     the 30-second step of the last code accepted, so a code works once
--   totp_recovery      JSON array of SHA-256 hashes of the unused recovery codes
--   totp_fails         wrong codes in a row; five locks the second step until totp_locked_until
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;
ALTER TABLE users ADD COLUMN totp_recovery TEXT;
ALTER TABLE users ADD COLUMN totp_fails INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_locked_until TEXT;
