-- pgTAP test for public.notification_log (20270510000000_notification_log.sql): service role only, nlog_ ids,
-- one recipient (a member or a place), one row per (recipient, kind, dedup key). Rolled back; `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(10);

SELECT ok(
  has_table_privilege('service_role', 'public.notification_log', 'INSERT')
    AND has_table_privilege('service_role', 'public.notification_log', 'DELETE'),
  'service role can claim and release');
SELECT ok(NOT has_table_privilege('authenticated', 'public.notification_log', 'SELECT'), 'signed-in users cannot read it');
SELECT ok(NOT has_table_privilege('authenticated', 'public.notification_log', 'INSERT'), 'signed-in users cannot write it');
SELECT ok(NOT has_table_privilege('anon', 'public.notification_log', 'SELECT'), 'signed-out visitors cannot read it');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_log'::regclass), 'row level security is on');

INSERT INTO public.notification_log (kind, place, dedup_key) VALUES ('changelog_digest', 'slack:CPGTAP', 'entry-one');

SELECT matches(
  (SELECT id FROM public.notification_log WHERE place = 'slack:CPGTAP'),
  '^nlog_[1-9A-HJ-NP-Za-km-z]{12}$',
  'id is a nlog_ prefixed short id');
SELECT is(
  (SELECT recipient FROM public.notification_log WHERE place = 'slack:CPGTAP'),
  'slack:CPGTAP',
  'a place is its own recipient');

SELECT throws_ok(
  $$INSERT INTO public.notification_log (kind, place, dedup_key) VALUES ('changelog_digest', 'slack:CPGTAP', 'entry-one')$$,
  '23505', NULL, 'the same claim twice is refused');
SELECT lives_ok(
  $$INSERT INTO public.notification_log (kind, place, dedup_key) VALUES ('changelog_digest', 'slack:CPGTAP', 'entry-two')$$,
  'another key is a new claim');
SELECT throws_ok(
  $$INSERT INTO public.notification_log (kind, dedup_key) VALUES ('changelog_digest', 'entry-three')$$,
  '23514', NULL, 'a row needs a member or a place');

SELECT * FROM finish(true);
ROLLBACK;
