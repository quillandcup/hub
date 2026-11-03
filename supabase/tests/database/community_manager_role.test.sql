-- A community manager reads the members and their staff notes (not the ones about themselves),
-- the billing and Slack metadata tables, and writes nothing. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(10);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000cb01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cm-manager@example.test'),
  ('00000000-0000-4000-a000-00000000cb02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cm-plain@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000cb01', 'cm-manager@example.test', 'community_manager'),
  ('00000000-0000-4000-a000-00000000cb02', 'cm-plain@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_CMgrAAAAAAA1', 'Manager Self', 'cm-manager@example.test', now(), 'active', '00000000-0000-4000-a000-00000000cb01'),
  ('mbr_CMgrAAAAAAA2', 'Other Member', 'cm-other@example.test', now(), 'active', NULL),
  ('mbr_CMgrAAAAAAA3', 'Plain Member', 'cm-plain@example.test', now(), 'active', '00000000-0000-4000-a000-00000000cb02');
INSERT INTO public.member_admin_notes (id, member_id, body) VALUES
  ('mnote_CMgrAAAAAA1', 'mbr_CMgrAAAAAAA1', 'about the manager'),
  ('mnote_CMgrAAAAAA2', 'mbr_CMgrAAAAAAA2', 'about someone else');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cb01", "email": "cm-manager@example.test", "role": "authenticated"}', true);

SELECT ok(public.is_community_manager(), 'is_community_manager() is true for the manager');
SELECT ok(NOT public.is_admin(), 'the manager is not an admin');
SELECT cmp_ok((SELECT count(*) FROM public.members WHERE id LIKE 'mbr_CMgrAAAAAAA%'), '=', 3::bigint, 'reads every member');
SELECT is((SELECT body FROM public.member_admin_notes WHERE id = 'mnote_CMgrAAAAAA2'), 'about someone else', 'reads a note on another member');
SELECT is_empty($$SELECT 1 FROM public.member_admin_notes WHERE id = 'mnote_CMgrAAAAAA1'$$, 'cannot read a note on their own record');
SELECT is_empty($$SELECT 1 FROM bronze.stripe_customers$$, 'can query the Stripe table (empty fixture, no permission error)');
SELECT throws_ok(
  $$INSERT INTO public.member_admin_notes (member_id, body) VALUES ('mbr_CMgrAAAAAAA2', 'nope')$$,
  '42501', NULL, 'cannot write a note');
SELECT is_empty(
  $$UPDATE public.members SET name = 'Renamed' WHERE id = 'mbr_CMgrAAAAAAA2' RETURNING 1$$,
  'cannot update a member');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cb02", "email": "cm-plain@example.test", "role": "authenticated"}', true);
SELECT ok(NOT public.is_community_manager(), 'a plain member is not a community manager');
SELECT is_empty($$SELECT 1 FROM public.member_admin_notes$$, 'a plain member reads no notes');

RESET ROLE;
SELECT * FROM finish(true);
ROLLBACK;
