-- pgTAP tests for several roles per user (user_roles, 20271008000000 and the drop of user_profiles.role in 20271110000000): the table and
-- its RLS, the helpers, set_user_roles() end to end, the audit entries, staff_member_ids(), the hook's claim, and that the old column,
-- its sync triggers and the split audit trigger are gone. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(35);

-- ee01 admin, ee02 two roles (community manager + conversion specialist), ee03 plain member, ee04 assistant + community manager, ee05 admin.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000ee01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ur-admin@example.test'),
  ('00000000-0000-4000-a000-00000000ee02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ur-two@example.test'),
  ('00000000-0000-4000-a000-00000000ee03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ur-member@example.test'),
  ('00000000-0000-4000-a000-00000000ee04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ur-assist@example.test'),
  ('00000000-0000-4000-a000-00000000ee05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ur-admin2@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000ee01', 'ur-admin@example.test'),
  ('00000000-0000-4000-a000-00000000ee02', 'ur-two@example.test'),
  ('00000000-0000-4000-a000-00000000ee03', 'ur-member@example.test'),
  ('00000000-0000-4000-a000-00000000ee04', 'ur-assist@example.test'),
  ('00000000-0000-4000-a000-00000000ee05', 'ur-admin2@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000ee01', 'admin'),
  ('00000000-0000-4000-a000-00000000ee02', 'community_manager'),
  ('00000000-0000-4000-a000-00000000ee02', 'conversion_specialist'),
  ('00000000-0000-4000-a000-00000000ee04', 'assistant'),
  ('00000000-0000-4000-a000-00000000ee04', 'community_manager'),
  ('00000000-0000-4000-a000-00000000ee05', 'admin');

-- 1. The old column and everything that kept it in step are gone ------------------------------------------------------
SELECT hasnt_column('public', 'user_profiles', 'role', 'user_profiles has no role column: roles live in user_roles only');
SELECT hasnt_trigger('public', 'user_roles', 'sync_profile_role', 'nothing copies user_roles into a column');
SELECT hasnt_trigger('public', 'user_profiles', 'sync_user_roles_insert', 'nor a profile insert into user_roles');
SELECT hasnt_trigger('public', 'user_profiles', 'sync_user_roles_update', 'nor a profile update');
SELECT hasnt_function('public', 'sync_profile_role_from_user_roles', 'the sync functions are gone');
SELECT hasnt_function('public', 'sync_user_roles_from_profile_role', 'both of them');
SELECT is(
  ARRAY(SELECT tgname::text FROM pg_trigger WHERE tgrelid = 'public.user_profiles'::regclass AND NOT tgisinternal AND tgname LIKE 'audit%' ORDER BY 1),
  ARRAY['audit_row_change'], 'the user_profiles audit trigger is one trigger again');
SELECT is(
  (SELECT pg_get_triggerdef(oid) ~ 'AFTER INSERT OR DELETE OR UPDATE ON' FROM pg_trigger WHERE tgrelid = 'public.user_profiles'::regclass AND tgname = 'audit_row_change'),
  true, 'for insert, update and delete');

-- 2. The helpers read user_roles --------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ee02", "email": "ur-two@example.test", "role": "authenticated"}', true);
SELECT ok(public.is_community_manager(), 'two roles: is_community_manager() is true');
SELECT ok(public.is_conversion_specialist(), 'two roles: is_conversion_specialist() is true');
SELECT ok(NOT public.is_admin(), 'two roles, neither admin: is_admin() stays false');
SELECT ok(NOT public.can_own_care_plans('00000000-0000-4000-a000-00000000ee03'), 'a plain member may not own plans');
SELECT ok(public.can_own_care_plans('00000000-0000-4000-a000-00000000ee04'), 'assistant + community manager may own plans');
SELECT is(
  ARRAY(SELECT role FROM public.user_roles ORDER BY role),
  ARRAY['community_manager', 'conversion_specialist'], 'a user reads their own roles and no one else''s');
SELECT throws_ok($$INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-a000-00000000ee02', 'admin')$$, '42501', NULL,
  'a user cannot give themselves a role');
SELECT is_empty($$DELETE FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee02' RETURNING 1$$, 'nor take their own away');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ee02', ARRAY['admin'])$$, '42501', NULL,
  'set_user_roles refuses a user who is not admin or assistant');
SELECT throws_ok($$SELECT public.user_has_any_role('00000000-0000-4000-a000-00000000ee02', ARRAY['admin'])$$, '42501', NULL,
  'the helper behind the policies is closed to clients');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ee04", "email": "ur-assist@example.test", "role": "authenticated"}', true);
SELECT ok(NOT public.is_admin(), 'an assistant is not is_admin()');
SELECT ok(public.is_community_manager(), 'an assistant who is also a community manager is is_community_manager()');

-- 3. Assigning, end to end: an admin replaces the set, the roles are what is stored ----------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ee05", "email": "ur-admin2@example.test", "role": "authenticated"}', true);
SELECT ok(public.is_admin(), 'an admin is is_admin()');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ee03', ARRAY['community_manager', 'conversion_specialist'])$$, 'an admin assigns two roles');
SELECT is(
  ARRAY(SELECT role FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee03' ORDER BY role),
  ARRAY['community_manager', 'conversion_specialist'], 'both are stored');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ee03', ARRAY['conversion_specialist', 'conversion_specialist'])$$,
  'assigning a smaller set removes the rest (duplicates are fine)');
SELECT is(
  ARRAY(SELECT role FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee03'),
  ARRAY['conversion_specialist'], 'one role is left');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ee03', ARRAY['superuser'])$$, '22023', NULL, 'an unknown role is refused');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ee03', ARRAY['member'])$$, 'member means no roles');
SELECT is((SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee03'), 0::bigint, 'and none are stored');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ee03', ARRAY['community_manager'])$$, 'assigned once more, for the audit rows');

-- 4. Audit: the entries name the person who assigned ---------------------------------------------------------------------------------
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.audit_log WHERE entity_type = 'user_role' AND action = 'insert' AND actor_kind = 'staff'
     AND changed_by = '00000000-0000-4000-a000-00000000ee05' AND entity_label = 'ur-member@example.test'),
  3::bigint, 'each role given is an entry by the admin, labelled with the account');
SELECT is(
  (SELECT count(*) FROM public.audit_log WHERE entity_type = 'user_role' AND action = 'delete'
     AND changed_by = '00000000-0000-4000-a000-00000000ee05' AND changes -> 'role' ->> 'old' = 'conversion_specialist'),
  1::bigint, 'taking a role away is an entry too');

-- 5. staff_member_ids() counts a person holding any staff role ---------------------------------------------------------------------------
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_UserRoleAAA1', 'Two Roles', 'ur-two@example.test', now(), 'active', '00000000-0000-4000-a000-00000000ee02'),
  ('mbr_UserRoleAAA2', 'Plain Member', 'ur-plain@example.test', now(), 'active', NULL);
SELECT ok('mbr_UserRoleAAA1' IN (SELECT public.staff_member_ids()), 'the member behind a two-role account is staff');
SELECT ok('mbr_UserRoleAAA2' NOT IN (SELECT public.staff_member_ids()), 'an ordinary member is not');

-- 6. The hook: app_roles lists every role, highest first ----------------------------------------------------------------------------------
CREATE TEMP TABLE hook_out ON COMMIT DROP AS
SELECT public.custom_access_token_hook(jsonb_build_object(
  'user_id', '00000000-0000-4000-a000-00000000ee04', 'claims', jsonb_build_object('role', 'authenticated'))) AS result;
SELECT is((SELECT result -> 'claims' -> 'app_roles' FROM hook_out), '["assistant", "community_manager"]'::jsonb,
  'the hook lists the roles in priority order');
SELECT ok(NOT (SELECT result -> 'claims' ? 'app_role' FROM hook_out), 'and no longer carries a single app_role');

SELECT * FROM finish(true);
ROLLBACK;
