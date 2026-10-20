-- pgTAP tests for analytics_control_rates (20261122000200): per named control, visits that saw it
-- and visits that also clicked it, lowest click-through first, with first_seen over all time,
-- the window, a route prefix, the admin-area switch, sudo left out, and RLS deciding who sees what.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000b5a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rates-alice@example.test'),
  ('00000000-0000-4000-a000-00000000b5a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rates-bob@example.test'),
  ('00000000-0000-4000-a000-00000000b5a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rates-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000b5a1', 'rates-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b5a2', 'rates-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b5a3', 'rates-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- The shared local DB may hold other events, so every assertion filters to this test's names
-- (they start with "rt-").
--
-- rt-join: seen by Alice in 2 visits (clicked in one) and by Bob in 1 (never clicked) -> 3 seen, 1 clicked.
-- rt-never: seen by Alice once, never clicked -> 1 seen, 0 clicked.
-- rt-always: seen and clicked by Bob once; Alice clicks it in a visit that never saw it (not counted).
-- rt-old: first seen 40 days ago, seen again now.
-- rt-admin: seen on an admin page. rt-sudo: seen only by the admin in sudo.
INSERT INTO public.analytics_events (message_id, user_id, session_id, event, properties, occurred_at, sudo) VALUES
  ('b5000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-00000000b5a1', 'c5000000-0000-4000-8000-000000000001', 'element_seen', '{"name": "rt-join", "route": "/dashboard"}', now() - interval '3 hours', false),
  ('b5000000-0000-4000-8000-000000000002', '00000000-0000-4000-a000-00000000b5a1', 'c5000000-0000-4000-8000-000000000001', 'element_clicked', '{"element": "button", "route": "/dashboard", "name": "rt-join"}', now() - interval '3 hours' + interval '1 minute', false),
  ('b5000000-0000-4000-8000-000000000003', '00000000-0000-4000-a000-00000000b5a1', 'c5000000-0000-4000-8000-000000000002', 'element_seen', '{"name": "rt-join", "route": "/courses"}', now() - interval '2 hours', false),
  -- A repeat impression in the same visit counts once.
  ('b5000000-0000-4000-8000-000000000004', '00000000-0000-4000-a000-00000000b5a1', 'c5000000-0000-4000-8000-000000000002', 'element_seen', '{"name": "rt-join", "route": "/courses"}', now() - interval '2 hours' + interval '5 minutes', false),
  ('b5000000-0000-4000-8000-000000000005', '00000000-0000-4000-a000-00000000b5a2', 'c5000000-0000-4000-8000-000000000003', 'element_seen', '{"name": "rt-join", "route": "/dashboard"}', now() - interval '1 hour', false),
  ('b5000000-0000-4000-8000-000000000006', '00000000-0000-4000-a000-00000000b5a1', 'c5000000-0000-4000-8000-000000000002', 'element_seen', '{"name": "rt-never", "route": "/dashboard"}', now() - interval '2 hours', false),
  ('b5000000-0000-4000-8000-000000000007', '00000000-0000-4000-a000-00000000b5a2', 'c5000000-0000-4000-8000-000000000003', 'element_seen', '{"name": "rt-always", "route": "/dashboard"}', now() - interval '1 hour', false),
  ('b5000000-0000-4000-8000-000000000008', '00000000-0000-4000-a000-00000000b5a2', 'c5000000-0000-4000-8000-000000000003', 'element_clicked', '{"element": "link", "route": "/dashboard", "name": "rt-always"}', now() - interval '1 hour' + interval '1 minute', false),
  ('b5000000-0000-4000-8000-000000000009', '00000000-0000-4000-a000-00000000b5a1', 'c5000000-0000-4000-8000-000000000009', 'element_clicked', '{"element": "link", "route": "/dashboard", "name": "rt-always"}', now() - interval '30 minutes', false),
  ('b5000000-0000-4000-8000-00000000000a', '00000000-0000-4000-a000-00000000b5a2', 'c5000000-0000-4000-8000-000000000008', 'element_seen', '{"name": "rt-old", "route": "/dashboard"}', now() - interval '40 days', false),
  ('b5000000-0000-4000-8000-00000000000b', '00000000-0000-4000-a000-00000000b5a2', 'c5000000-0000-4000-8000-000000000003', 'element_seen', '{"name": "rt-old", "route": "/dashboard"}', now() - interval '1 hour', false),
  ('b5000000-0000-4000-8000-00000000000c', '00000000-0000-4000-a000-00000000b5a3', 'c5000000-0000-4000-8000-000000000004', 'element_seen', '{"name": "rt-admin", "route": "/admin/members"}', now() - interval '1 hour', false),
  ('b5000000-0000-4000-8000-00000000000d', '00000000-0000-4000-a000-00000000b5a3', 'c5000000-0000-4000-8000-000000000005', 'element_seen', '{"name": "rt-sudo", "route": "/dashboard"}', now() - interval '1 hour', true);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000b5a3", "role": "authenticated"}', true);
INSERT INTO result VALUES ('all', (
  SELECT jsonb_agg(to_jsonb(t) - 'first_seen' ORDER BY ord)
  FROM (SELECT t.*, row_number() OVER () AS ord FROM public.analytics_control_rates(now() - interval '1 day') t WHERE t.name LIKE 'rt-%') t));
INSERT INTO result VALUES ('names_no_admin', (
  SELECT jsonb_agg(t.name ORDER BY t.name)
  FROM public.analytics_control_rates(now() - interval '1 day', NULL, true) t WHERE t.name LIKE 'rt-%'));
INSERT INTO result VALUES ('names_courses', (
  SELECT jsonb_agg(t.name ORDER BY t.name)
  FROM public.analytics_control_rates(now() - interval '1 day', '/courses') t WHERE t.name LIKE 'rt-%'));
INSERT INTO result VALUES ('old_first_seen_days', to_jsonb((
  SELECT round(extract(epoch FROM now() - t.first_seen) / 86400)::int
  FROM public.analytics_control_rates(now() - interval '1 day') t WHERE t.name = 'rt-old')));

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000b5a2", "role": "authenticated"}', true);
INSERT INTO result VALUES ('bob', (
  SELECT jsonb_agg(to_jsonb(t) - 'first_seen' ORDER BY t.name)
  FROM public.analytics_control_rates(now() - interval '1 day') t WHERE t.name LIKE 'rt-%'));

RESET ROLE;

-- Lowest click-through first: rt-never 0/1 and rt-old 0/1 (ties by most visits, then name), then
-- rt-join 1/3, then the admin one 0/1 ... ordered by rate: 0, 0, 0, 1/3, 1.
SELECT is(
  (SELECT value FROM result WHERE label = 'all'),
  '[{"name": "rt-admin", "seen_sessions": 1, "seen_members": 1, "clicked_sessions": 0, "clicked_members": 0, "ord": 1},
    {"name": "rt-never", "seen_sessions": 1, "seen_members": 1, "clicked_sessions": 0, "clicked_members": 0, "ord": 2},
    {"name": "rt-old", "seen_sessions": 1, "seen_members": 1, "clicked_sessions": 0, "clicked_members": 0, "ord": 3},
    {"name": "rt-join", "seen_sessions": 3, "seen_members": 2, "clicked_sessions": 1, "clicked_members": 1, "ord": 4},
    {"name": "rt-always", "seen_sessions": 1, "seen_members": 1, "clicked_sessions": 1, "clicked_members": 1, "ord": 5}]'::jsonb,
  'counts visits that saw a control and, of those, visits that clicked it; lowest rate first; repeats in a visit count once; sudo left out');
SELECT is((SELECT value FROM result WHERE label = 'names_no_admin'), '["rt-always", "rt-join", "rt-never", "rt-old"]'::jsonb, 'hide_admin leaves out controls seen on admin pages');
SELECT is((SELECT value FROM result WHERE label = 'names_courses'), '["rt-join"]'::jsonb, 'route_prefix keeps only controls seen under it');
SELECT is((SELECT value FROM result WHERE label = 'old_first_seen_days'), '40'::jsonb, 'first_seen looks past the window');
SELECT is(
  (SELECT value FROM result WHERE label = 'bob'),
  '[{"name": "rt-always", "seen_sessions": 1, "seen_members": 1, "clicked_sessions": 1, "clicked_members": 1},
    {"name": "rt-join", "seen_sessions": 1, "seen_members": 1, "clicked_sessions": 0, "clicked_members": 0},
    {"name": "rt-old", "seen_sessions": 1, "seen_members": 1, "clicked_sessions": 0, "clicked_members": 0}]'::jsonb,
  'a member only sees their own events (RLS)');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'analytics_control_rates' AND NOT p.prosecdef),
  1, 'it runs as the caller (SECURITY INVOKER)');
SELECT is(
  has_function_privilege('anon', 'public.analytics_control_rates(timestamptz, text, boolean)', 'EXECUTE'),
  false, 'anonymous callers cannot execute it');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.analytics_events WHERE properties ->> 'name' = 'rt-sudo' AND NOT sudo),
  'fixture check: the sudo-only control has only sudo impressions');

SELECT * FROM finish(true);
ROLLBACK;
