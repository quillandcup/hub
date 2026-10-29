-- pgTAP test for public.calendar_sync_state (20270224200000_calendar_sync_state.sql): service role
-- only. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

SELECT ok(has_table_privilege('service_role', 'public.calendar_sync_state', 'INSERT'), 'service role can write sync state');
SELECT ok(NOT has_table_privilege('authenticated', 'public.calendar_sync_state', 'SELECT'), 'signed-in users cannot read sync state');
SELECT ok(NOT has_table_privilege('anon', 'public.calendar_sync_state', 'SELECT'), 'signed-out visitors cannot read sync state');

INSERT INTO public.calendar_sync_state (calendar_id) VALUES ('cal@example.test');
SELECT is((SELECT rerun_requested FROM public.calendar_sync_state WHERE calendar_id = 'cal@example.test'), false, 'no rerun is requested by default');
SELECT throws_ok($$INSERT INTO public.calendar_sync_state (calendar_id) VALUES ('cal@example.test')$$, '23505', NULL, 'one row per calendar');

SELECT * FROM finish(true);
ROLLBACK;
