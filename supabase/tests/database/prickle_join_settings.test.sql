-- pgTAP tests for prickle_join_settings (20261109000000): any signed-in member can read the Zoom
-- link history, only admins can add rows, links must be https, nothing is ever updated, and only a
-- not-yet-effective row can be deleted. Runs in one transaction that is rolled back.
-- Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000c1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pj-member@example.test'),
  ('00000000-0000-4000-a000-00000000c1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pj-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000c1a1', 'pj-member@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000c1a4', 'pj-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- One setting already in effect and one scheduled for the future.
INSERT INTO public.prickle_join_settings (id, join_url, passcode, effective_from) VALUES
  ('00000000-0000-4000-a000-00000000c101', 'https://zoom.example.test/j/1', 'past', now() - interval '10 days'),
  ('00000000-0000-4000-a000-00000000c102', 'https://zoom.example.test/j/2', 'future', now() + interval '10 days');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- A member reads the history but can't change it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c1a1", "email": "pj-member@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_reads', to_jsonb(count(*)) FROM public.prickle_join_settings;
RESET ROLE;
SELECT is((SELECT value FROM result WHERE label = 'member_reads'), '2'::jsonb, 'a member reads the link history');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c1a1", "email": "pj-member@example.test", "role": "authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.prickle_join_settings (join_url, passcode) VALUES ('https://zoom.example.test/j/3', 'x')$$,
  '42501', NULL, 'a member cannot add a setting'
);
DELETE FROM public.prickle_join_settings WHERE id = '00000000-0000-4000-a000-00000000c102';
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.prickle_join_settings WHERE id = '00000000-0000-4000-a000-00000000c102'),
  1,
  'a member cannot delete even a scheduled setting'
);

-- An admin adds one, but only over https.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c1a4", "email": "pj-admin@example.test", "role": "authenticated"}', true);
SELECT lives_ok(
  $$INSERT INTO public.prickle_join_settings (join_url, passcode) VALUES ('https://zoom.example.test/j/4', 'new')$$,
  'an admin can add a setting'
);
SELECT throws_ok(
  $$INSERT INTO public.prickle_join_settings (join_url, passcode) VALUES ('http://zoom.example.test/j/5', 'x')$$,
  '23514', NULL, 'a join link must be https'
);

-- Nothing is ever edited: no UPDATE policy, so an update changes no rows.
UPDATE public.prickle_join_settings SET passcode = 'changed' WHERE id = '00000000-0000-4000-a000-00000000c101';
INSERT INTO result SELECT 'passcode_after_update', to_jsonb(passcode) FROM public.prickle_join_settings
  WHERE id = '00000000-0000-4000-a000-00000000c101';

-- A setting already in effect can't be deleted, a scheduled one can.
DELETE FROM public.prickle_join_settings WHERE id = '00000000-0000-4000-a000-00000000c101';
INSERT INTO result SELECT 'past_after_delete', to_jsonb(count(*)) FROM public.prickle_join_settings
  WHERE id = '00000000-0000-4000-a000-00000000c101';
DELETE FROM public.prickle_join_settings WHERE id = '00000000-0000-4000-a000-00000000c102';
INSERT INTO result SELECT 'future_after_delete', to_jsonb(count(*)) FROM public.prickle_join_settings
  WHERE id = '00000000-0000-4000-a000-00000000c102';
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'passcode_after_update'), '"past"'::jsonb, 'an admin cannot edit a setting');
SELECT is((SELECT value FROM result WHERE label = 'past_after_delete'), '1'::jsonb, 'a setting already in effect cannot be deleted');
SELECT is((SELECT value FROM result WHERE label = 'future_after_delete'), '0'::jsonb, 'an admin can remove a scheduled setting');
SELECT * FROM finish(true);
ROLLBACK;
