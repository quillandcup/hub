-- pgTAP: a member may set their own display_name only to one of their active name aliases
-- (20261120000100_member_self_service_display_name.sql), and still can't touch other columns.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dn-login@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', 'dn-login@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('00000000-0000-4000-a000-00000000d101', 'Dn Member', 'dn-member@example.test', now(), 'active',
   '00000000-0000-4000-a000-00000000d1a1');
INSERT INTO public.member_name_aliases (member_id, alias, source, active) VALUES
  ('00000000-0000-4000-a000-00000000d101', 'Dn Pen', 'member', true),
  ('00000000-0000-4000-a000-00000000d101', 'Dn Retired', 'member', false);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d1a1", "email": "dn-login@example.test", "role": "authenticated"}', true);

SELECT lives_ok(
  $$UPDATE public.members SET display_name = 'Dn Pen' WHERE id = '00000000-0000-4000-a000-00000000d101'$$,
  'member can set display_name to an active alias');
SELECT is((SELECT display_name FROM public.members WHERE id = '00000000-0000-4000-a000-00000000d101'),
  'Dn Pen', 'display_name was saved');
SELECT throws_ok(
  $$UPDATE public.members SET display_name = 'Someone Else' WHERE id = '00000000-0000-4000-a000-00000000d101'$$,
  '42501', NULL, 'display_name must be one of the member''s aliases');
SELECT throws_ok(
  $$UPDATE public.members SET display_name = 'Dn Retired' WHERE id = '00000000-0000-4000-a000-00000000d101'$$,
  '42501', NULL, 'an inactive alias is rejected');
SELECT lives_ok(
  $$UPDATE public.members SET display_name = NULL WHERE id = '00000000-0000-4000-a000-00000000d101'$$,
  'member can clear display_name');
SELECT throws_ok(
  $$UPDATE public.members SET status = 'cancelled' WHERE id = '00000000-0000-4000-a000-00000000d101'$$,
  '42501', NULL, 'other columns are still locked');

SELECT * FROM finish(true);
ROLLBACK;
