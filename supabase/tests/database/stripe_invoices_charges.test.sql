-- pgTAP test for bronze.stripe_invoices and bronze.stripe_charges (20270724000000_stripe_invoices_charges.sql):
-- service role only, short ids with their prefixes, one row per Stripe id, and no raw payload, card or
-- customer detail columns. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(16);

SELECT ok(
  has_table_privilege('service_role', 'bronze.stripe_invoices', 'SELECT')
    AND has_table_privilege('service_role', 'bronze.stripe_invoices', 'INSERT')
    AND has_table_privilege('service_role', 'bronze.stripe_invoices', 'UPDATE'),
  'service role can read and write invoices');
SELECT ok(
  has_table_privilege('service_role', 'bronze.stripe_charges', 'SELECT')
    AND has_table_privilege('service_role', 'bronze.stripe_charges', 'INSERT')
    AND has_table_privilege('service_role', 'bronze.stripe_charges', 'UPDATE'),
  'service role can read and write charges');

SELECT ok(NOT has_table_privilege('anon', 'bronze.stripe_invoices', 'SELECT'), 'signed-out visitors cannot read invoices');
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.stripe_invoices', 'SELECT'), 'signed-in users cannot read invoices');
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.stripe_invoices', 'INSERT'), 'signed-in users cannot write invoices');
SELECT ok(NOT has_table_privilege('anon', 'bronze.stripe_charges', 'SELECT'), 'signed-out visitors cannot read charges');
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.stripe_charges', 'SELECT'), 'signed-in users cannot read charges');
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.stripe_charges', 'UPDATE'), 'signed-in users cannot write charges');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'bronze.stripe_invoices'::regclass), 'row level security is on for invoices');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'bronze.stripe_charges'::regclass), 'row level security is on for charges');

INSERT INTO bronze.stripe_invoices (stripe_invoice_id, stripe_customer_id, status, created_at_stripe)
VALUES ('in_PGTAP1', 'cus_PGTAP1', 'paid', now());
INSERT INTO bronze.stripe_charges (stripe_charge_id, stripe_customer_id, status, created_at_stripe)
VALUES ('ch_PGTAP1', 'cus_PGTAP1', 'succeeded', now());

SELECT matches(
  (SELECT id FROM bronze.stripe_invoices WHERE stripe_invoice_id = 'in_PGTAP1'),
  '^stinv_[1-9A-HJ-NP-Za-km-z]{12}$',
  'an invoice id is a stinv_ prefixed short id');
SELECT matches(
  (SELECT id FROM bronze.stripe_charges WHERE stripe_charge_id = 'ch_PGTAP1'),
  '^stchg_[1-9A-HJ-NP-Za-km-z]{12}$',
  'a charge id is a stchg_ prefixed short id');

SELECT throws_ok(
  $$INSERT INTO bronze.stripe_invoices (stripe_invoice_id, stripe_customer_id, status, created_at_stripe) VALUES ('in_PGTAP1', 'cus_PGTAP1', 'open', now())$$,
  '23505', NULL, 'one row per Stripe invoice id');
SELECT throws_ok(
  $$INSERT INTO bronze.stripe_charges (stripe_charge_id, status, created_at_stripe) VALUES ('ch_PGTAP1', 'failed', now())$$,
  '23505', NULL, 'one row per Stripe charge id');

SELECT is(
  (SELECT amount_due + amount_paid + amount_remaining + attempt_count FROM bronze.stripe_invoices WHERE stripe_invoice_id = 'in_PGTAP1'),
  0::bigint, 'invoice amounts default to zero');
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'bronze' AND table_name IN ('stripe_invoices', 'stripe_charges')
      AND (column_name IN ('data', 'raw_payload', 'email', 'name', 'failure_message', 'receipt_url') OR column_name LIKE '%card%' OR column_name LIKE '%address%')),
  0, 'no raw payload, customer detail, failure message or card column');

SELECT * FROM finish(true);
ROLLBACK;
