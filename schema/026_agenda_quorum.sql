-- How many voting members the club had when a meeting adjourned, so the quorum
-- shown on a past agenda does not change as members join or lapse later.
-- NULL until the meeting adjourns; until then the current count is used.
-- Who counts is defined in src/lib/agenda.js (VOTING_MEMBER).

ALTER TABLE agendas ADD COLUMN voting_members INTEGER;
