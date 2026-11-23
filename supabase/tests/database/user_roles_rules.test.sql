-- pgTAP tests for who may change whose roles (enforce_user_role_changes on user_roles, 20271028000000_user_roles.sql):
-- an actor gives or takes away only roles strictly below their own highest role, on people strictly below it (an admin: any);
-- nobody removes their own admin role; the service role and a session without a user are exempt. Rolled back; `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(29);

-- ad1, ad2 admins; as1, as2 assistants; cm1 community manager; mb1, mb2 plain members.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000ef01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rules-ad1@example.test'),
  ('00000000-0000-4000-a000-00000000ef02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rules-ad2@example.test'),
  ('00000000-0000-4000-a000-00000000ef03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rules-as1@example.test'),
  ('00000000-0000-4000-a000-00000000ef04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rules-as2@example.test'),
  ('00000000-0000-4000-a000-00000000ef05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rules-cm1@example.test'),
  ('00000000-0000-4000-a000-00000000ef06', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rules-mb1@example.test'),
  ('00000000-0000-4000-a000-00000000ef07', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rules-mb2@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000ef01', 'rules-ad1@example.test'),
  ('00000000-0000-4000-a000-00000000ef02', 'rules-ad2@example.test'),
  ('00000000-0000-4000-a000-00000000ef03', 'rules-as1@example.test'),
  ('00000000-0000-4000-a000-00000000ef04', 'rules-as2@example.test'),
  ('00000000-0000-4000-a000-00000000ef05', 'rules-cm1@example.test'),
  ('00000000-0000-4000-a000-00000000ef06', 'rules-mb1@example.test'),
  ('00000000-0000-4000-a000-00000000ef07', 'rules-mb2@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000ef01', 'admin'),
  ('00000000-0000-4000-a000-00000000ef02', 'admin'),
  ('00000000-0000-4000-a000-00000000ef03', 'assistant'),
  ('00000000-0000-4000-a000-00000000ef04', 'assistant'),
  ('00000000-0000-4000-a000-00000000ef05', 'community_manager')
ON CONFLICT (user_id, role) DO NOTHING;

SET LOCAL ROLE authenticated;

-- 1. An assistant -------------------------------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ef03", "email": "rules-as1@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef06', ARRAY['community_manager'])$$, 'an assistant gives a member the community manager role');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef06', ARRAY['community_manager', 'conversion_specialist'])$$, 'and the conversion specialist role');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef05', ARRAY['conversion_specialist'])$$, 'and swaps a community manager for a conversion specialist');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef06', ARRAY[]::text[])$$, 'and takes them away');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef06', ARRAY['admin'])$$, '42501', 'An assistant can only give or take away the community manager and conversion specialist roles', 'an assistant cannot give admin');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef06', ARRAY['assistant'])$$, '42501', 'An assistant can only give or take away the community manager and conversion specialist roles', 'nor assistant');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef06', ARRAY['community_manager', 'admin'])$$, '42501', NULL, 'nor admin hidden in a list');
SELECT is((SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ef06'), 0::bigint, 'and a refused change leaves nothing behind');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef01', ARRAY[]::text[])$$, '42501', 'An assistant can''t change the roles of an admin or another assistant', 'an assistant cannot take an admin''s role away');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef01', ARRAY['admin', 'community_manager'])$$, '42501', NULL, 'nor add a role to an admin');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef04', ARRAY['assistant', 'community_manager'])$$, '42501', 'An assistant can''t change the roles of an admin or another assistant', 'nor change another assistant');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef03', ARRAY['assistant', 'community_manager'])$$, '42501', NULL, 'nor themself');
SELECT throws_ok($$INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-a000-00000000ef06', 'community_manager')$$, '42501', NULL, 'a direct insert as an assistant is refused (row-level security)');
SELECT is_empty($$DELETE FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ef01' RETURNING 1$$, 'and a direct delete finds no row to delete');

-- 2. Someone who manages no roles ----------------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ef05", "email": "rules-cm1@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef06', ARRAY['community_manager'])$$, '42501', 'Only admins and assistants can change roles', 'a community manager cannot change roles');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef05', ARRAY['admin'])$$, '42501', NULL, 'nor give themself admin');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ef07", "email": "rules-mb2@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef07', ARRAY['admin'])$$, '42501', 'Only admins and assistants can change roles', 'a member cannot make themself admin');

-- 3. An admin -------------------------------------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ef01", "email": "rules-ad1@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef06', ARRAY['admin', 'assistant'])$$, 'an admin gives admin and assistant');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef04', ARRAY['community_manager'])$$, 'an admin takes an assistant''s role away (gives a lower one)');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef06', ARRAY['assistant'])$$, 'an admin removes another admin''s admin role while they remain one');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef01', ARRAY[]::text[])$$, '42501', 'You can''t remove your own admin role; ask another admin', 'an admin cannot remove their own admin role');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef01', ARRAY['community_manager'])$$, '42501', NULL, 'not even by swapping it for another');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef01', ARRAY['admin', 'community_manager'])$$, 'but may change their other roles');
SELECT is(
  (SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ef01' AND role = 'admin'), 1::bigint,
  'and the admin role is still there after the refused attempts');
SELECT throws_ok($$DELETE FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ef01' AND role = 'admin'$$, '42501', 'You can''t remove your own admin role; ask another admin', 'a direct delete of one''s own admin row is refused too');

-- 4. The service role and a session with no user are exempt ---------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef07', ARRAY['admin'])$$, 'the service role gives admin');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ef07', ARRAY[]::text[])$$, 'and takes it away');
RESET ROLE;

-- 5. Deleting an account takes its roles with it, whatever they were ----------------------------------------------------
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ef01", "email": "rules-ad1@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$DELETE FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000ef02'$$, 'an admin may delete another admin''s account (its roles go with it)');
SELECT is((SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ef02'), 0::bigint, 'and the roles are gone');
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
