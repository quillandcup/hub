-- pgTAP tests for 20270320000000_analytics_rollups.sql: who may read the rollups and call the functions that
-- build them and remove old usage events.
--   * rollups are readable by admins only (they hold no ids, but they are usage numbers);
--   * only the service role may run the rollup, list unrolled periods or remove events;
--   * the removal never touches an event whose day, week and month are not all rolled up.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

SELECT ok(NOT has_function_privilege('authenticated', 'public.analytics_rollup_period(text, date, text)', 'EXECUTE'), 'a member can''t run a rollup');
SELECT ok(NOT has_function_privilege('authenticated', 'public.analytics_unrolled_periods(text, timestamptz)', 'EXECUTE'), 'a member can''t list unrolled periods');
SELECT ok(NOT has_function_privilege('authenticated', 'public.analytics_prune_usage_events(timestamptz, text, integer)', 'EXECUTE'), 'a member can''t remove events');
SELECT ok(NOT has_function_privilege('anon', 'public.analytics_prune_usage_events(timestamptz, text, integer)', 'EXECUTE'), 'nor can an anonymous visitor');
SELECT ok(has_function_privilege('service_role', 'public.analytics_prune_usage_events(timestamptz, text, integer)', 'EXECUTE'), 'the service role can');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fa01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rollup-member@example.test'),
  ('00000000-0000-4000-a000-00000000fa02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rollup-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000fa01', 'rollup-member@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000fa02', 'rollup-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.analytics_rollups (period_kind, period_start, audience, event, dimension, value, events, visits, members)
VALUES ('day', '2020-01-01', 'member', 'pg_rollup_event', 'total', '', 3, 2, 1);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fa01", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_sees', to_jsonb(count(*)) FROM public.analytics_rollups WHERE event = 'pg_rollup_event';
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fa02", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.analytics_rollups WHERE event = 'pg_rollup_event';
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member_sees'), '0'::jsonb, 'a member can''t read the rollups');
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '1'::jsonb, 'an admin can');

-- An old event whose period is not rolled up is not removed; once its day, week and month are, it is.
INSERT INTO public.analytics_events (user_id, message_id, session_id, source, event, properties, occurred_at, sudo)
VALUES ('00000000-0000-4000-a000-00000000fa01', 'fa000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-0000000000a1', 'client', 'pg_old_event', '{}', '2019-06-12 15:00:00+00', false);
SELECT is(public.analytics_prune_usage_events('2020-01-01', 'America/New_York', 5000), 0, 'an event whose period is not rolled up is kept');
SELECT public.analytics_rollup_period('day', '2019-06-12', 'America/New_York');
SELECT public.analytics_rollup_period('week', '2019-06-09', 'America/New_York');
SELECT public.analytics_rollup_period('month', '2019-06-01', 'America/New_York');
SELECT is(public.analytics_prune_usage_events('2020-01-01', 'America/New_York', 5000), 1, 'once its day, week and month are rolled up, it is removed');

SELECT * FROM finish(true);
ROLLBACK;
