-- pgTAP tests for analytics_top_clicks (20261113000200): clicks ranked by their best label, with
-- a route prefix, an admin-area switch, sudo left out, and RLS deciding who sees what.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000b3a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'topclicks-alice@example.test'),
  ('00000000-0000-4000-a000-00000000b3a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'topclicks-bob@example.test'),
  ('00000000-0000-4000-a000-00000000b3a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'topclicks-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000b3a1', 'topclicks-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b3a2', 'topclicks-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b3a3', 'topclicks-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- The shared local DB may hold other events, so every assertion filters to this test's labels
-- (they start with "tc").
INSERT INTO public.analytics_events (message_id, user_id, session_id, event, properties, occurred_at, sudo) VALUES
  -- "Join on Zoom" (text) twice by Alice on two pages, once by Bob.
  ('b3000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-00000000b3a1', 'c3000000-0000-4000-8000-000000000001', 'element_clicked', '{"element": "link", "route": "/dashboard", "text": "tc Join on Zoom"}', now(), false),
  ('b3000000-0000-4000-8000-000000000002', '00000000-0000-4000-a000-00000000b3a1', 'c3000000-0000-4000-8000-000000000002', 'element_clicked', '{"element": "link", "route": "/courses/[id]", "text": "tc Join on Zoom"}', now(), false),
  ('b3000000-0000-4000-8000-000000000003', '00000000-0000-4000-a000-00000000b3a2', 'c3000000-0000-4000-8000-000000000003', 'element_clicked', '{"element": "link", "route": "/dashboard", "text": "tc Join on Zoom"}', now(), false),
  -- A data-track name beats the text.
  ('b3000000-0000-4000-8000-000000000004', '00000000-0000-4000-a000-00000000b3a1', 'c3000000-0000-4000-8000-000000000001', 'element_clicked', '{"element": "button", "route": "/dashboard", "name": "tc-save-goal", "text": "Save"}', now(), false),
  -- Only a target route to go on.
  ('b3000000-0000-4000-8000-000000000005', '00000000-0000-4000-a000-00000000b3a2', 'c3000000-0000-4000-8000-000000000003', 'element_clicked', '{"element": "link", "route": "/dashboard", "target_route": "/tc-streaks"}', now(), false),
  -- An admin-area click, and a sudo one.
  ('b3000000-0000-4000-8000-000000000006', '00000000-0000-4000-a000-00000000b3a3', 'c3000000-0000-4000-8000-000000000004', 'element_clicked', '{"element": "button", "route": "/admin/analytics", "text": "tc Run"}', now(), false),
  ('b3000000-0000-4000-8000-000000000007', '00000000-0000-4000-a000-00000000b3a3', 'c3000000-0000-4000-8000-000000000005', 'element_clicked', '{"element": "button", "route": "/dashboard", "text": "tc Sudo only"}', now(), true),
  -- Not a click.
  ('b3000000-0000-4000-8000-000000000008', '00000000-0000-4000-a000-00000000b3a1', 'c3000000-0000-4000-8000-000000000001', 'page_viewed', '{"route": "/dashboard"}', now(), false);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000b3a3", "role": "authenticated"}', true);
INSERT INTO result VALUES ('all', (
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.events DESC, t.label)
  FROM public.analytics_top_clicks(now() - interval '1 hour') t WHERE t.label LIKE 'tc%' OR t.label LIKE '/tc-%'));
INSERT INTO result VALUES ('no_admin', (
  SELECT jsonb_agg(t.label ORDER BY t.label)
  FROM public.analytics_top_clicks(now() - interval '1 hour', NULL, true) t WHERE t.label LIKE 'tc%' OR t.label LIKE '/tc-%'));
INSERT INTO result VALUES ('courses_only', (
  SELECT jsonb_agg(t.label ORDER BY t.label)
  FROM public.analytics_top_clicks(now() - interval '1 hour', '/courses') t WHERE t.label LIKE 'tc%' OR t.label LIKE '/tc-%'));

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000b3a2", "role": "authenticated"}', true);
INSERT INTO result VALUES ('bob', (
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.label)
  FROM public.analytics_top_clicks(now() - interval '1 hour') t WHERE t.label LIKE 'tc%' OR t.label LIKE '/tc-%'));

RESET ROLE;

SELECT is(
  (SELECT value FROM result WHERE label = 'all'),
  '[{"label": "tc Join on Zoom", "element": "link", "events": 3, "members": 2, "sessions": 3, "routes": 2},
    {"label": "/tc-streaks", "element": "link", "events": 1, "members": 1, "sessions": 1, "routes": 1},
    {"label": "tc Run", "element": "button", "events": 1, "members": 1, "sessions": 1, "routes": 1},
    {"label": "tc-save-goal", "element": "button", "events": 1, "members": 1, "sessions": 1, "routes": 1}]'::jsonb,
  'ranks clicks by name, else text, else target route; counts events, members, visits and pages; leaves out sudo and other events');
SELECT is((SELECT value FROM result WHERE label = 'no_admin'), '["/tc-streaks", "tc Join on Zoom", "tc-save-goal"]'::jsonb, 'hide_admin leaves out the admin area');
SELECT is((SELECT value FROM result WHERE label = 'courses_only'), '["tc Join on Zoom"]'::jsonb, 'route_prefix keeps only clicks on pages under it');
SELECT is(
  (SELECT value FROM result WHERE label = 'bob'),
  '[{"label": "/tc-streaks", "element": "link", "events": 1, "members": 1, "sessions": 1, "routes": 1},
    {"label": "tc Join on Zoom", "element": "link", "events": 1, "members": 1, "sessions": 1, "routes": 1}]'::jsonb,
  'a member only sees their own clicks (RLS)');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'analytics_top_clicks' AND NOT p.prosecdef),
  1, 'it runs as the caller (SECURITY INVOKER)');
SELECT is(
  has_function_privilege('anon', 'public.analytics_top_clicks(timestamptz, text, boolean, boolean, boolean)', 'EXECUTE'),
  false, 'anonymous callers cannot execute it');

SELECT * FROM finish(true);
ROLLBACK;
