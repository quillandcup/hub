-- pgTAP tests for analytics_property_breakdown (20261113000100): counts of one event grouped by a
-- property's value, with an optional filter, sudo left out, and RLS deciding who sees what.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000b2a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'breakdown-alice@example.test'),
  ('00000000-0000-4000-a000-00000000b2a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'breakdown-bob@example.test'),
  ('00000000-0000-4000-a000-00000000b2a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'breakdown-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000b2a1', 'breakdown-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b2a2', 'breakdown-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b2a3', 'breakdown-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Alice opens twice while live (two visits) and once off air; Bob once while live; one event has
-- no `live` at all; the admin in sudo opens once (left out); another event kind is ignored.
INSERT INTO public.analytics_events (message_id, user_id, session_id, event, properties, occurred_at, sudo) VALUES
  ('b2000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-00000000b2a1', 'c2000000-0000-4000-8000-000000000001', 'onair_popover_opened', '{"live": true, "room_size": 2}', now() - interval '3 hours', false),
  ('b2000000-0000-4000-8000-000000000002', '00000000-0000-4000-a000-00000000b2a1', 'c2000000-0000-4000-8000-000000000002', 'onair_popover_opened', '{"live": true, "room_size": 3}', now() - interval '2 hours', false),
  ('b2000000-0000-4000-8000-000000000003', '00000000-0000-4000-a000-00000000b2a1', 'c2000000-0000-4000-8000-000000000002', 'onair_popover_opened', '{"live": false, "room_size": 0}', now() - interval '1 hour', false),
  ('b2000000-0000-4000-8000-000000000004', '00000000-0000-4000-a000-00000000b2a2', 'c2000000-0000-4000-8000-000000000003', 'onair_popover_opened', '{"live": true, "room_size": 2}', now() - interval '30 minutes', false),
  ('b2000000-0000-4000-8000-000000000005', '00000000-0000-4000-a000-00000000b2a2', 'c2000000-0000-4000-8000-000000000003', 'onair_popover_opened', '{}', now() - interval '20 minutes', false),
  ('b2000000-0000-4000-8000-000000000006', '00000000-0000-4000-a000-00000000b2a3', 'c2000000-0000-4000-8000-000000000004', 'onair_popover_opened', '{"live": true, "room_size": 1}', now() - interval '10 minutes', true),
  ('b2000000-0000-4000-8000-000000000007', '00000000-0000-4000-a000-00000000b2a1', 'c2000000-0000-4000-8000-000000000002', 'onair_join_clicked', '{"live": true, "room_size": 3}', now() - interval '90 minutes', false);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000b2a3", "role": "authenticated"}', true);
INSERT INTO result VALUES ('by_live', (
  SELECT jsonb_agg(to_jsonb(b) ORDER BY b.events DESC, b.value NULLS LAST)
  FROM public.analytics_property_breakdown('onair_popover_opened', 'live', now() - interval '1 day') b));
INSERT INTO result VALUES ('by_room_size_when_live', (
  SELECT jsonb_agg(to_jsonb(b) ORDER BY b.value)
  FROM public.analytics_property_breakdown('onair_popover_opened', 'room_size', now() - interval '1 day', '{"live": true}') b));
INSERT INTO result VALUES ('outside_window', to_jsonb((
  SELECT count(*) FROM public.analytics_property_breakdown('onair_popover_opened', 'live', now() - interval '45 minutes'))));

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000b2a2", "role": "authenticated"}', true);
INSERT INTO result VALUES ('bob_sees', (
  SELECT jsonb_agg(to_jsonb(b) ORDER BY b.value NULLS LAST)
  FROM public.analytics_property_breakdown('onair_popover_opened', 'live', now() - interval '1 day') b));

RESET ROLE;

SELECT is(
  (SELECT value FROM result WHERE label = 'by_live'),
  '[{"value": "true", "events": 3, "members": 2, "sessions": 3},
    {"value": "false", "events": 1, "members": 1, "sessions": 1},
    {"value": null, "events": 1, "members": 1, "sessions": 1}]'::jsonb,
  'groups by the property, counting events, members and visits, and leaves out sudo and other events');
SELECT is(
  (SELECT value FROM result WHERE label = 'by_room_size_when_live'),
  '[{"value": "2", "events": 2, "members": 2, "sessions": 2},
    {"value": "3", "events": 1, "members": 1, "sessions": 1}]'::jsonb,
  'a filter limits it to matching events');
SELECT is((SELECT value FROM result WHERE label = 'outside_window'), '2'::jsonb, 'only events inside the window count (30 and 20 minutes ago: true and unset)');
SELECT is(
  (SELECT value FROM result WHERE label = 'bob_sees'),
  '[{"value": "true", "events": 1, "members": 1, "sessions": 1},
    {"value": null, "events": 1, "members": 1, "sessions": 1}]'::jsonb,
  'a member only sees their own events (RLS)');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'analytics_property_breakdown' AND NOT p.prosecdef),
  1, 'it runs as the caller (SECURITY INVOKER)');
SELECT is(
  has_function_privilege('anon', 'public.analytics_property_breakdown(text, text, timestamptz, jsonb, boolean, boolean)', 'EXECUTE'),
  false, 'anonymous callers cannot execute it');

SELECT * FROM finish(true);
ROLLBACK;
