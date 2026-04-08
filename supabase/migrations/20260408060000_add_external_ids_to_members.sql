-- Add external IDs to members table for linking to Kajabi and Stripe
ALTER TABLE members
ADD COLUMN kajabi_id TEXT,
ADD COLUMN stripe_customer_id TEXT;

CREATE INDEX idx_members_kajabi_id ON members(kajabi_id);
CREATE INDEX idx_members_stripe_customer_id ON members(stripe_customer_id);

COMMENT ON COLUMN members.kajabi_id IS 'Kajabi contact ID for linking to app.kajabi.com/admin/contacts/{kajabi_id}';
COMMENT ON COLUMN members.stripe_customer_id IS 'Stripe customer ID for linking to dashboard.stripe.com/customers/{stripe_customer_id}';
