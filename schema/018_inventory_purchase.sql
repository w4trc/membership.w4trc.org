-- Inventory: how each item was acquired. For a donated item the same columns hold
-- the date received, the estimated value, and who donated it.
ALTER TABLE inventory_items ADD COLUMN purchase_date  TEXT;
ALTER TABLE inventory_items ADD COLUMN purchase_price REAL;
ALTER TABLE inventory_items ADD COLUMN purchased_from TEXT;
ALTER TABLE inventory_items ADD COLUMN is_donated     INTEGER NOT NULL DEFAULT 0;
