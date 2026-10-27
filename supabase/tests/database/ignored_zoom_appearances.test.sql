-- pgTAP tests for ignored_zoom_appearances (20270120000000): a Zoom name ignored for one prickle
-- only. Admins read and write it, members can't, a name is ignored once per prickle, and the
-- rows go with their prickle. Runs in one transaction that is rolled back.
-- Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000c1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'iza-member@example.test'),
  ('00000000-0000-4000-a000-00000000c1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'iza-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000c1a1', 'iza-member@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000c1a4', 'iza-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.prickles (id, start_time, end_time, source) VALUES
  ('prkl_IZAtestAAAA1', now(), now() + interval '1 hour', 'calendar'),
  ('prkl_IZAtestAAAA2', now(), now() + interval '1 hour', 'calendar');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c1a4", "email": "iza-admin@example.test", "role": "authenticated"}', true);
INSERT INTO public.ignored_zoom_appearances (prickle_id, zoom_name) VALUES ('prkl_IZAtestAAAA1', 'iPhone');
INSERT INTO result SELECT 'admin_reads', to_jsonb(count(*)) FROM public.ignored_zoom_appearances;

SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c1a1", "email": "iza-member@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_reads', to_jsonb(count(*)) FROM public.ignored_zoom_appearances;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'admin_reads'), '1'::jsonb, 'an admin reads and writes ignores');
SELECT is((SELECT value FROM result WHERE label = 'member_reads'), '0'::jsonb, 'a member sees none');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c1a1", "email": "iza-member@example.test", "role": "authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.ignored_zoom_appearances (prickle_id, zoom_name) VALUES ('prkl_IZAtestAAAA2', 'iPhone')$$,
  '42501', NULL, 'a member cannot ignore a name');
RESET ROLE;

SELECT throws_ok(
  $$INSERT INTO public.ignored_zoom_appearances (prickle_id, zoom_name) VALUES ('prkl_IZAtestAAAA1', 'iPhone')$$,
  '23505', NULL, 'a name is ignored once per prickle');

INSERT INTO public.ignored_zoom_appearances (prickle_id, zoom_name) VALUES ('prkl_IZAtestAAAA2', 'iPhone');
SELECT is(
  (SELECT count(*)::int FROM public.ignored_zoom_appearances WHERE zoom_name = 'iPhone'), 2,
  'the same name can be ignored on another prickle');

SELECT matches(
  (SELECT id FROM public.ignored_zoom_appearances LIMIT 1), '^igza_[1-9A-HJ-NP-Za-km-z]{12}$',
  'rows get an igza_ id');
SELECT matches(
  obj_description('public.ignored_zoom_appearances'::regclass, 'pg_class'), '\[id prefix: igza\_\]$',
  'the table comment records the id prefix');

DELETE FROM public.prickles WHERE id = 'prkl_IZAtestAAAA1';
SELECT is(
  (SELECT count(*)::int FROM public.ignored_zoom_appearances WHERE prickle_id = 'prkl_IZAtestAAAA1'), 0,
  'deleting a prickle removes its ignores');

SELECT * FROM finish(true);
ROLLBACK;
