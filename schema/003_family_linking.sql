-- Migration 003: Family membership linking
-- Allows one member's dues record to be linked as "covered under" another member's family membership

ALTER TABLE memberships ADD COLUMN covered_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_memberships_covered_by ON memberships(covered_by_member_id);
