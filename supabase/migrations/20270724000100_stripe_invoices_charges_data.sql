set lock_timeout = '5s';

-- Keep Stripe's whole object next to the extracted columns, like bronze.stripe_subscriptions.data, so Silver
-- can be rebuilt from Bronze and a field not extracted today can be read later without re-pulling.
-- Nullable on purpose: the code live during a deploy writes rows without it. Same access as before (service
-- role only, no new grants).

ALTER TABLE bronze.stripe_invoices ADD COLUMN data jsonb;
ALTER TABLE bronze.stripe_charges ADD COLUMN data jsonb;

COMMENT ON COLUMN bronze.stripe_invoices.data IS
  'The whole Stripe invoice object, with its expanded payments. Service role only.';
COMMENT ON COLUMN bronze.stripe_charges.data IS
  'The whole Stripe charge object. Includes card brand and last four digits and the billing name, email and address. Service role only.';

COMMENT ON TABLE bronze.stripe_invoices IS
  'Bronze: Stripe invoices (pull import, upsert on stripe_invoice_id). Amounts in cents; data holds the whole object. Service role only. [id prefix: stinv_]';
COMMENT ON TABLE bronze.stripe_charges IS
  'Bronze: Stripe charges (pull import, upsert on stripe_charge_id). Amounts in cents; data holds the whole object, card details and billing contact included. Service role only. [id prefix: stchg_]';
