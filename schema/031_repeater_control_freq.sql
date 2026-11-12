-- The control frequency: what the repeater's control receiver listens on, so a
-- control operator can shut it down or change it over the air. Receive only,
-- so there is just the one frequency (MHz, as typed). Kept out of the MCP
-- tools along with the screen PIN.
ALTER TABLE repeaters ADD COLUMN control_freq TEXT;
