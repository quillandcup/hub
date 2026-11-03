-- pgTAP test for bronze.resend_events (20270428000200_resend_events.sql): service role only, ids use the
-- rsev_ prefix, one row per event id. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

SELECT ok(
  has_table_privilege('service_role', 'bronze.resend_events', 'INSERT')
    AND has_table_privilege('service_role', 'bronze.resend_events', 'SELECT'),
  'service role can write and read events');
SELECT ok(
  NOT has_table_privilege('authenticated', 'bronze.resend_events', 'SELECT'),
  'signed-in users cannot read events (they hold recipients and subjects)');
SELECT ok(
  NOT has_table_privilege('authenticated', 'bronze.resend_events', 'INSERT'),
  'signed-in users cannot write events');
SELECT ok(
  NOT has_table_privilege('anon', 'bronze.resend_events', 'SELECT'),
  'signed-out visitors cannot read events');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'bronze.resend_events'::regclass),
  'row level security is on');

INSERT INTO bronze.resend_events (event_id, event_type, email_id, occurred_at, recipients, raw_payload)
VALUES ('svix-pgtap-1', 'email.sent', 'em-pgtap-1', now(), ARRAY['ada@example.test'], '{}'::jsonb);

SELECT matches(
  (SELECT id FROM bronze.resend_events WHERE event_id = 'svix-pgtap-1'),
  '^rsev_[1-9A-HJ-NP-Za-km-z]{12}$',
  'id is a rsev_ prefixed short id');

SELECT is(
  (SELECT tags FROM bronze.resend_events WHERE event_id = 'svix-pgtap-1'),
  '{}'::jsonb,
  'tags default to an empty object');

SELECT throws_ok(
  $$INSERT INTO bronze.resend_events (event_id, event_type, email_id, occurred_at, raw_payload)
    VALUES ('svix-pgtap-1', 'email.sent', 'em-pgtap-1', now(), '{}'::jsonb)$$,
  '23505',
  NULL,
  'an event id is stored once, so a webhook retry cannot duplicate it');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_member_activities_resend_related'),
  'a member timeline row can be found by its email id without a scan');

SELECT * FROM finish(true);
ROLLBACK;
