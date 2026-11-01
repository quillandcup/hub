-- pgTAP test for public.calendar_watch_channels (20270224100000_calendar_watch_channels.sql):
-- service role only, ids use the cwch_ prefix. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

SELECT ok(
  has_table_privilege('service_role', 'public.calendar_watch_channels', 'INSERT'),
  'service role can write channels');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.calendar_watch_channels', 'SELECT'),
  'signed-in users cannot read channels');
SELECT ok(
  NOT has_table_privilege('anon', 'public.calendar_watch_channels', 'SELECT'),
  'signed-out visitors cannot read channels');

INSERT INTO public.calendar_watch_channels (calendar_id, channel_id, resource_id, expires_at)
VALUES ('cal@example.test', 'chan-1', 'res-1', now() + interval '7 days');

SELECT matches(
  (SELECT id FROM public.calendar_watch_channels WHERE channel_id = 'chan-1'),
  '^cwch_[1-9A-HJ-NP-Za-km-z]{12}$',
  'id is a cwch_ prefixed short id');

SELECT throws_ok(
  $$INSERT INTO public.calendar_watch_channels (calendar_id, channel_id, resource_id, expires_at)
    VALUES ('cal@example.test', 'chan-1', 'res-2', now())$$,
  '23505',
  NULL,
  'channel_id is unique');

SELECT * FROM finish(true);
ROLLBACK;
