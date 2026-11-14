set lock_timeout = '5s';

-- Stripe invoices and charges as Bronze data: who was billed what and when. Only the columns the Hub needs;
-- no raw payload, no card details, no billing address, no receipt URL, no customer email or name, and no
-- free-text failure message (the failure code only).
--
-- Service role only. Nothing reads them as a signed-in user yet; an admin read goes through the
-- server (BillingRepository) after its own check.

CREATE TABLE bronze.stripe_invoices (
  id                     text PRIMARY KEY DEFAULT public.new_id('stinv'),
  -- Stripe's id: the upsert key.
  stripe_invoice_id      text NOT NULL UNIQUE,
  stripe_customer_id     text NOT NULL,
  stripe_subscription_id text,
  -- draft, open, paid, uncollectible, void
  status                 text NOT NULL,
  billing_reason         text,
  collection_method      text,
  currency               text,
  -- Minor units (cents).
  amount_due             bigint NOT NULL DEFAULT 0,
  amount_paid            bigint NOT NULL DEFAULT 0,
  amount_remaining       bigint NOT NULL DEFAULT 0,
  attempt_count          integer NOT NULL DEFAULT 0,
  created_at_stripe      timestamptz NOT NULL,
  period_start           timestamptz,
  period_end             timestamptz,
  due_date               timestamptz,
  -- status_transitions.paid_at
  paid_at                timestamptz,
  next_payment_attempt   timestamptz,
  stripe_charge_id       text,
  -- The first line's product id, so an invoice can be tied to a product.
  stripe_product_id      text,
  description            text,
  paid_out_of_band       boolean NOT NULL DEFAULT false,
  imported_at            timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stripe_invoices_customer_idx ON bronze.stripe_invoices (stripe_customer_id, created_at_stripe);
CREATE INDEX stripe_invoices_created_idx ON bronze.stripe_invoices (created_at_stripe);
CREATE INDEX stripe_invoices_open_idx ON bronze.stripe_invoices (status) WHERE status IN ('draft', 'open');

COMMENT ON TABLE bronze.stripe_invoices IS
  'Bronze: Stripe invoices (pull import, upsert on stripe_invoice_id). Amounts in cents. Service role only. [id prefix: stinv_]';

CREATE TABLE bronze.stripe_charges (
  id                 text PRIMARY KEY DEFAULT public.new_id('stchg'),
  stripe_charge_id   text NOT NULL UNIQUE,
  stripe_customer_id text,
  stripe_invoice_id  text,
  amount             bigint NOT NULL DEFAULT 0,
  amount_refunded    bigint NOT NULL DEFAULT 0,
  currency           text,
  -- succeeded, pending, failed
  status             text NOT NULL,
  paid               boolean NOT NULL DEFAULT false,
  refunded           boolean NOT NULL DEFAULT false,
  disputed           boolean NOT NULL DEFAULT false,
  created_at_stripe  timestamptz NOT NULL,
  -- Stripe's machine code (card_declined...), never the free-text message.
  failure_code       text,
  description        text,
  imported_at        timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stripe_charges_customer_idx ON bronze.stripe_charges (stripe_customer_id, created_at_stripe);
CREATE INDEX stripe_charges_invoice_idx ON bronze.stripe_charges (stripe_invoice_id);

COMMENT ON TABLE bronze.stripe_charges IS
  'Bronze: Stripe charges (pull import, upsert on stripe_charge_id). Amounts in cents. No card details. Service role only. [id prefix: stchg_]';

ALTER TABLE bronze.stripe_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE bronze.stripe_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bronze.stripe_invoices, bronze.stripe_charges FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bronze.stripe_invoices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON bronze.stripe_charges TO service_role;
