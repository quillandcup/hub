-- pgTAP tests for the audience filters (20261122000300): ignore_staff and ignore_sudo on every
-- analytics function, and the two helpers behind them.
-- Staff = an admin profile, or a member with a staff_role. A sudo event belongs to the member being
-- viewed, so ignore_staff does not remove it; ignore_sudo alone decides whether it counts.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(15);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000b6a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aud-alice@example.test'),
  ('00000000-0000-4000-a000-00000000b6a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aud-bob-staff@example.test'),
  ('00000000-0000-4000-a000-00000000b6a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aud-admin@example.test'),
  ('00000000-0000-4000-a000-00000000b6a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aud-nobody@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000b6a1', 'aud-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b6a2', 'aud-bob-staff@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b6a3', 'aud-admin@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000b6a4', 'aud-nobody@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
-- Alice is a plain member; Bob is staff through his member record (not an admin); the admin has no member record.
INSERT INTO public.members (id, name, email, joined_at, status, user_id, staff_role) VALUES
  ('00000000-0000-4000-a000-00000000b6b1', 'Aud Alice', 'aud-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000b6a1', NULL),
  ('00000000-0000-4000-a000-00000000b6b2', 'Aud Bob', 'aud-bob-staff@example.test', now(), 'active', '00000000-0000-4000-a000-00000000b6a2', 'staff');

-- Each of Alice, Bob, the admin and the admin in sudo sees and clicks "au-x" once, in their own visit.
INSERT INTO public.analytics_events (message_id, user_id, session_id, event, properties, occurred_at, sudo) VALUES
  ('b6000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-00000000b6a1', 'c6000000-0000-4000-8000-000000000001', 'element_seen', '{"name": "au-x", "route": "/dashboard"}', now() - interval '50 minutes', false),
  ('b6000000-0000-4000-8000-000000000002', '00000000-0000-4000-a000-00000000b6a1', 'c6000000-0000-4000-8000-000000000001', 'element_clicked', '{"element": "button", "route": "/dashboard", "name": "au-x"}', now() - interval '49 minutes', false),
  ('b6000000-0000-4000-8000-000000000003', '00000000-0000-4000-a000-00000000b6a2', 'c6000000-0000-4000-8000-000000000002', 'element_seen', '{"name": "au-x", "route": "/dashboard"}', now() - interval '40 minutes', false),
  ('b6000000-0000-4000-8000-000000000004', '00000000-0000-4000-a000-00000000b6a2', 'c6000000-0000-4000-8000-000000000002', 'element_clicked', '{"element": "button", "route": "/dashboard", "name": "au-x"}', now() - interval '39 minutes', false),
  ('b6000000-0000-4000-8000-000000000005', '00000000-0000-4000-a000-00000000b6a3', 'c6000000-0000-4000-8000-000000000003', 'element_seen', '{"name": "au-x", "route": "/dashboard"}', now() - interval '30 minutes', false),
  ('b6000000-0000-4000-8000-000000000006', '00000000-0000-4000-a000-00000000b6a3', 'c6000000-0000-4000-8000-000000000003', 'element_clicked', '{"element": "button", "route": "/dashboard", "name": "au-x"}', now() - interval '29 minutes', false),
  ('b6000000-0000-4000-8000-000000000007', '00000000-0000-4000-a000-00000000b6a3', 'c6000000-0000-4000-8000-000000000004', 'element_seen', '{"name": "au-x", "route": "/dashboard"}', now() - interval '20 minutes', true),
  ('b6000000-0000-4000-8000-000000000008', '00000000-0000-4000-a000-00000000b6a3', 'c6000000-0000-4000-8000-000000000004', 'element_clicked', '{"element": "button", "route": "/dashboard", "name": "au-x"}', now() - interval '19 minutes', true);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000b6a3", "role": "authenticated"}', true);

-- Helpers.
INSERT INTO result VALUES ('staff_flags', (
  SELECT jsonb_build_object(
    'alice', public.analytics_is_staff('00000000-0000-4000-a000-00000000b6a1'),
    'bob', public.analytics_is_staff('00000000-0000-4000-a000-00000000b6a2'),
    'admin', public.analytics_is_staff('00000000-0000-4000-a000-00000000b6a3'),
    'nobody', public.analytics_is_staff('00000000-0000-4000-a000-00000000b6a4'),
    'unknown', public.analytics_is_staff(gen_random_uuid()))));

-- Clicks of "au-x" (top clicks), in each combination of the two filters.
INSERT INTO result VALUES ('clicks_default', to_jsonb((SELECT events FROM public.analytics_top_clicks(now() - interval '1 day') WHERE label = 'au-x')));
INSERT INTO result VALUES ('clicks_ignore_staff', to_jsonb((SELECT events FROM public.analytics_top_clicks(now() - interval '1 day', NULL, false, true) WHERE label = 'au-x')));
INSERT INTO result VALUES ('clicks_with_sudo', to_jsonb((SELECT events FROM public.analytics_top_clicks(now() - interval '1 day', NULL, false, false, false) WHERE label = 'au-x')));
INSERT INTO result VALUES ('clicks_ignore_staff_with_sudo', to_jsonb((SELECT events FROM public.analytics_top_clicks(now() - interval '1 day', NULL, false, true, false) WHERE label = 'au-x')));

-- The other functions honour the same two flags.
INSERT INTO result VALUES ('rates', (
  SELECT jsonb_build_object(
    'default', (SELECT seen_sessions FROM public.analytics_control_rates(now() - interval '1 day') WHERE name = 'au-x'),
    'ignore_staff', (SELECT seen_sessions FROM public.analytics_control_rates(now() - interval '1 day', NULL, false, true) WHERE name = 'au-x'),
    'with_sudo', (SELECT seen_sessions FROM public.analytics_control_rates(now() - interval '1 day', NULL, false, false, false) WHERE name = 'au-x'))));
INSERT INTO result VALUES ('breakdown', (
  SELECT jsonb_build_object(
    'default', (SELECT events FROM public.analytics_property_breakdown('element_clicked', 'name', now() - interval '1 day', '{"name": "au-x"}')),
    'ignore_staff', (SELECT events FROM public.analytics_property_breakdown('element_clicked', 'name', now() - interval '1 day', '{"name": "au-x"}', true)),
    'with_sudo', (SELECT events FROM public.analytics_property_breakdown('element_clicked', 'name', now() - interval '1 day', '{"name": "au-x"}', false, false)))));
INSERT INTO result VALUES ('funnel', (
  SELECT jsonb_build_object(
    'default', (SELECT sessions FROM public.analytics_funnel(ARRAY['element_seen', 'element_clicked'], now() - interval '1 day', '[{"name": "au-x"}, {"name": "au-x"}]') WHERE step = 2),
    'ignore_staff', (SELECT sessions FROM public.analytics_funnel(ARRAY['element_seen', 'element_clicked'], now() - interval '1 day', '[{"name": "au-x"}, {"name": "au-x"}]', true) WHERE step = 2),
    'with_sudo', (SELECT sessions FROM public.analytics_funnel(ARRAY['element_seen', 'element_clicked'], now() - interval '1 day', '[{"name": "au-x"}, {"name": "au-x"}]', false, false) WHERE step = 2))));
INSERT INTO result VALUES ('summary', (
  SELECT jsonb_build_object(
    'default', (SELECT events FROM public.analytics_event_summary(now() - interval '1 day') WHERE event = 'element_seen'),
    'ignore_staff', (SELECT events FROM public.analytics_event_summary(now() - interval '1 day', true) WHERE event = 'element_seen'),
    'with_sudo', (SELECT events FROM public.analytics_event_summary(now() - interval '1 day', false, false) WHERE event = 'element_seen'))));

RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'staff_flags'),
  '{"alice": false, "bob": true, "admin": true, "nobody": false, "unknown": false}'::jsonb,
  'staff = an admin profile or a member with a staff_role; anyone else, and anyone unknown, is not');
SELECT is((SELECT value FROM result WHERE label = 'clicks_default'), '3'::jsonb, 'by default staff count and sudo does not (as before)');
SELECT is((SELECT value FROM result WHERE label = 'clicks_ignore_staff'), '1'::jsonb, 'ignore_staff leaves only the plain member');
SELECT is((SELECT value FROM result WHERE label = 'clicks_with_sudo'), '4'::jsonb, 'ignore_sudo = false adds the sudo click');
SELECT is((SELECT value FROM result WHERE label = 'clicks_ignore_staff_with_sudo'), '2'::jsonb,
  'ignore_staff does not remove sudo events: the plain member plus the sudo click');
-- Control rates / breakdown / funnel / summary: same three views (default, ignore staff, with sudo).
-- Visits that saw au-x: default Alice+Bob+admin = 3; ignore staff = Alice = 1; with sudo = 4.
SELECT is((SELECT value FROM result WHERE label = 'rates'), '{"default": 3, "ignore_staff": 1, "with_sudo": 4}'::jsonb, 'control rates honour both filters');
SELECT is((SELECT value FROM result WHERE label = 'breakdown'), '{"default": 3, "ignore_staff": 1, "with_sudo": 4}'::jsonb, 'property breakdown honours both filters');
SELECT is((SELECT value FROM result WHERE label = 'funnel'), '{"default": 3, "ignore_staff": 1, "with_sudo": 4}'::jsonb, 'funnel honours both filters');
SELECT is((SELECT value FROM result WHERE label = 'summary'), '{"default": 3, "ignore_staff": 1, "with_sudo": 4}'::jsonb, 'event summary honours both filters');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('analytics_is_staff', 'analytics_counts', 'analytics_event_summary', 'analytics_funnel', 'analytics_property_breakdown', 'analytics_top_clicks', 'analytics_control_rates') AND p.prosecdef),
  0, 'none of them is SECURITY DEFINER: RLS still decides what a caller sees');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('analytics_event_summary', 'analytics_funnel', 'analytics_property_breakdown', 'analytics_top_clicks', 'analytics_control_rates')),
  5, 'the old signatures were dropped, so each function exists once (no ambiguous overloads)');
SELECT is(has_function_privilege('anon', 'public.analytics_is_staff(uuid)', 'EXECUTE'), false, 'anonymous callers cannot call the staff helper');
SELECT is(has_function_privilege('anon', 'public.analytics_counts(boolean, uuid, boolean, boolean)', 'EXECUTE'), false, 'anonymous callers cannot call the audience helper');
SELECT is(has_function_privilege('authenticated', 'public.analytics_funnel(text[], timestamptz, jsonb, boolean, boolean)', 'EXECUTE'), true, 'signed-in callers can run the funnel');
SELECT is(has_function_privilege('anon', 'public.analytics_event_summary(timestamptz, boolean, boolean)', 'EXECUTE'), false, 'anonymous callers cannot run the summary');

SELECT * FROM finish(true);
ROLLBACK;
