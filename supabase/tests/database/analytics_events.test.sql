-- pgTAP tests for analytics_events (20261113000000): members write and read only their own rows, admins
-- read all, retried inserts are idempotent, the funnel counts ordered steps per visit and
-- leaves out sudo, and events go with the account.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(14);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000b1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'analytics-alice@example.test'),
  ('00000000-0000-4000-a000-00000000b1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'analytics-bob@example.test'),
  ('00000000-0000-4000-a000-00000000b1a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'analytics-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000b1a1', 'analytics-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b1a2', 'analytics-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b1a3', 'analytics-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Alice, visit 1: opened while live, then joined. Visit 2: opened while off air, never joined.
-- Bob: joined without opening first (no step 1, so not in the funnel). Admin in sudo: opened and
-- joined, which must not count.
INSERT INTO public.analytics_events (message_id, user_id, session_id, event, properties, occurred_at, sudo) VALUES
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-00000000b1a1', 'c0000000-0000-4000-8000-000000000001', 'onair_popover_opened', '{"live": true, "room_size": 2}', now() - interval '10 minutes', false),
  ('b0000000-0000-4000-8000-000000000002', '00000000-0000-4000-a000-00000000b1a1', 'c0000000-0000-4000-8000-000000000001', 'onair_join_clicked',    '{"live": true, "room_size": 2}', now() - interval '9 minutes', false),
  ('b0000000-0000-4000-8000-000000000003', '00000000-0000-4000-a000-00000000b1a1', 'c0000000-0000-4000-8000-000000000002', 'onair_popover_opened', '{"live": false, "room_size": 0}', now() - interval '5 minutes', false),
  ('b0000000-0000-4000-8000-000000000004', '00000000-0000-4000-a000-00000000b1a2', 'c0000000-0000-4000-8000-000000000003', 'onair_join_clicked',    '{"live": true, "room_size": 1}', now() - interval '4 minutes', false),
  ('b0000000-0000-4000-8000-000000000005', '00000000-0000-4000-a000-00000000b1a3', 'c0000000-0000-4000-8000-000000000004', 'onair_popover_opened', '{"live": true, "room_size": 1}', now() - interval '3 minutes', true),
  ('b0000000-0000-4000-8000-000000000006', '00000000-0000-4000-a000-00000000b1a3', 'c0000000-0000-4000-8000-000000000004', 'onair_join_clicked',    '{"live": true, "room_size": 1}', now() - interval '2 minutes', true),
  -- Join before open in the same visit: not a step 2 after step 1.
  ('b0000000-0000-4000-8000-000000000007', '00000000-0000-4000-a000-00000000b1a2', 'c0000000-0000-4000-8000-000000000005', 'onair_join_clicked',    '{"live": true, "room_size": 1}', now() - interval '8 minutes', false),
  ('b0000000-0000-4000-8000-000000000008', '00000000-0000-4000-a000-00000000b1a2', 'c0000000-0000-4000-8000-000000000005', 'onair_popover_opened', '{"live": true, "room_size": 1}', now() - interval '7 minutes', false);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

-- Alice: can record her own event, can't record one as Bob, reads back only her own.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000b1a1", "role": "authenticated"}', true);
INSERT INTO public.analytics_events (message_id, user_id, session_id, event, occurred_at)
VALUES ('b0000000-0000-4000-8000-000000000009', '00000000-0000-4000-a000-00000000b1a1', 'c0000000-0000-4000-8000-000000000001', 'page_viewed', now());
INSERT INTO result VALUES ('alice_reads', to_jsonb((SELECT count(*) FROM public.analytics_events)));
DO $$
BEGIN
  INSERT INTO public.analytics_events (message_id, user_id, session_id, event, occurred_at)
  VALUES ('b0000000-0000-4000-8000-00000000000a', '00000000-0000-4000-a000-00000000b1a2', 'c0000000-0000-4000-8000-000000000001', 'page_viewed', now());
  INSERT INTO result VALUES ('alice_as_bob', 'true');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO result VALUES ('alice_as_bob', 'false');
END $$;
-- A retried event (same user and message id) is skipped, not an error, the way the receiver
-- sends it (upsert with ignoreDuplicates).
INSERT INTO public.analytics_events (message_id, user_id, session_id, event, occurred_at)
VALUES ('b0000000-0000-4000-8000-000000000009', '00000000-0000-4000-a000-00000000b1a1', 'c0000000-0000-4000-8000-000000000001', 'page_viewed', now())
ON CONFLICT (user_id, message_id) DO NOTHING;
INSERT INTO result VALUES ('alice_funnel', to_jsonb((SELECT count(*) FROM public.analytics_funnel(ARRAY['onair_popover_opened'], now() - interval '1 day'))));
INSERT INTO result VALUES ('alice_funnel_sessions', to_jsonb((SELECT sessions FROM public.analytics_funnel(ARRAY['onair_popover_opened'], now() - interval '1 day') WHERE step = 1)));

-- The admin reads everything.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000b1a3", "role": "authenticated"}', true);
INSERT INTO result VALUES ('admin_reads', to_jsonb((SELECT count(*) FROM public.analytics_events WHERE message_id::text LIKE 'b0000000-0000-4000-8000-0000000000%')));
INSERT INTO result VALUES ('funnel_all', (
  SELECT jsonb_agg(sessions ORDER BY step)
  FROM public.analytics_funnel(ARRAY['onair_popover_opened', 'onair_join_clicked'], now() - interval '1 day')));
INSERT INTO result VALUES ('funnel_live', (
  SELECT jsonb_agg(sessions ORDER BY step)
  FROM public.analytics_funnel(ARRAY['onair_popover_opened', 'onair_join_clicked'], now() - interval '1 day', '[{"live": true}, {"live": true}]')));
INSERT INTO result VALUES ('funnel_off_air', (
  SELECT jsonb_agg(sessions ORDER BY step)
  FROM public.analytics_funnel(ARRAY['onair_popover_opened', 'onair_join_clicked'], now() - interval '1 day', '[{"live": false}, {"live": false}]')));
INSERT INTO result VALUES ('funnel_empty', to_jsonb((SELECT count(*) FROM public.analytics_funnel(ARRAY[]::text[], now() - interval '1 day'))));
INSERT INTO result VALUES ('summary_opened', (
  SELECT to_jsonb(s) - 'last_seen' FROM public.analytics_event_summary(now() - interval '1 day') s WHERE s.event = 'onair_popover_opened'));

RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'alice_reads'), '4'::jsonb, 'a member reads back only their own events');
SELECT is((SELECT value FROM result WHERE label = 'alice_as_bob'), 'false'::jsonb, 'a member cannot record an event as someone else');
SELECT is((SELECT count(*)::int FROM public.analytics_events WHERE message_id = 'b0000000-0000-4000-8000-000000000009'), 1, 'a retried event is stored once');
SELECT is((SELECT value FROM result WHERE label = 'alice_funnel'), '1'::jsonb, 'the funnel runs for a member without error');
SELECT is((SELECT value FROM result WHERE label = 'alice_funnel_sessions'), '2'::jsonb, 'and the funnel only counts their own visits (RLS)');
SELECT is((SELECT value FROM result WHERE label = 'admin_reads'), '9'::jsonb, 'an admin reads every event, sudo ones included');
-- Step 1: visits 1 and 2 of Alice, plus Bob's c..05 visit. The sudo visit is left out.
-- Step 2: Alice's visit 1 only; Bob's join came before his open, so it isn't a step after it.
SELECT is((SELECT value FROM result WHERE label = 'funnel_all'), '[3, 1]'::jsonb, 'funnel counts ordered steps per visit and skips sudo');
SELECT is((SELECT value FROM result WHERE label = 'funnel_live'), '[2, 1]'::jsonb, 'a step filter keeps only matching events (live)');
SELECT is((SELECT value FROM result WHERE label = 'funnel_off_air'), '[1, 0]'::jsonb, 'a step filter keeps only matching events (off air)');
SELECT is((SELECT value FROM result WHERE label = 'funnel_empty'), '0'::jsonb, 'an empty funnel has no steps');
SELECT is(
  (SELECT value FROM result WHERE label = 'summary_opened'),
  '{"event": "onair_popover_opened", "events": 3, "members": 2, "sessions": 3}'::jsonb,
  'the summary counts events, members and visits without sudo');

-- Erased with the account.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-a000-00000000b1a1';
SELECT is((SELECT count(*)::int FROM public.analytics_events WHERE user_id = '00000000-0000-4000-a000-00000000b1a1'), 0, 'events are deleted with the account');

SELECT has_index('public', 'analytics_events', 'analytics_events_event_occurred_idx', 'event index exists');
SELECT throws_ok(
  $$INSERT INTO public.analytics_events (message_id, user_id, session_id, event, properties, occurred_at) VALUES (gen_random_uuid(), '00000000-0000-4000-a000-00000000b1a2', gen_random_uuid(), 'x', jsonb_build_object('k', repeat('a', 5000)), now())$$,
  '23514', NULL, 'oversized properties are refused');

SELECT * FROM finish(true);
ROLLBACK;
