-- Password reset tokens
-- Run: wrangler d1 execute karc-membership --file=schema/012_password_reset.sql

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens(expires_at);
