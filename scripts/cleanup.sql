-- KARC Member Data Cleanup
-- Hard-deletes all member data (memberships and notes cascade from members).
-- Run BEFORE import-members.js to start with a clean slate.
--
-- Local:  npx wrangler d1 execute karc-membership --local --file=scripts/cleanup.sql
-- Prod:   npx wrangler d1 execute karc-membership --remote --file=scripts/cleanup.sql
--         (requires dotenv -e .env -- prefix if using .env file)

DELETE FROM notes;
DELETE FROM memberships;
DELETE FROM members;
