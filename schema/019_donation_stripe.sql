-- Online donations: link a donation to the Stripe Checkout session that paid for it.
-- The unique index makes the webhook idempotent if Stripe delivers an event twice.

ALTER TABLE donations ADD COLUMN stripe_session_id TEXT;

CREATE UNIQUE INDEX idx_donations_stripe_session ON donations(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
