-- pgTAP tests for several roles per user (20271028000000_user_roles.sql): the table and its RLS, the backfill,
-- the helpers over both role sources, the primary role kept in user_profiles.role, set_user_roles(), the audit
-- entries, and the access token hook's app_roles. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(42);

-- Fixture users: a1 admin, a2 two roles (community manager + conversion specialist), a3 plain member,
-- a4 assistant + community manager, a5 admin (the one who assigns in the audit checks).
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000ee01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ur-admin@example.test'),
  ('00000000-0000-4000-a000-00000000ee02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ur-two@example.test'),
  ('00000000-0000-4000-a000-00000000ee03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ur-member@example.test'),
  ('00000000-0000-4000-a000-00000000ee04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ur-assist@example.test'),
  ('00000000-0000-4000-a000-00000000ee05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ur-admin2@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000ee01', 'ur-admin@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000ee02', 'ur-two@example.test', 'community_manager'),
  ('00000000-0000-4000-a000-00000000ee03', 'ur-member@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000ee04', 'ur-assist@example.test', 'assistant'),
  ('00000000-0000-4000-a000-00000000ee05', 'ur-admin2@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- 1. Writing the old column directly keeps user_roles in step (the legacy path) -------------------------------
SELECT is(
  ARRAY(SELECT role FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee01'),
  ARRAY['admin'], 'a profile written with a staff role gets the matching user_roles row');
SELECT is((SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee03'), 0::bigint,
  'a member has no user_roles row');

-- 2. The backfill statement gives the same answer as the sync (idempotent, set-based) ---------------------------
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, p.role FROM public.user_profiles p
WHERE p.role IN ('admin', 'assistant', 'community_manager', 'conversion_specialist')
ON CONFLICT (user_id, role) DO NOTHING;
SELECT is(
  (SELECT count(*) FROM public.user_roles r JOIN public.user_profiles p ON p.id = r.user_id AND p.role = r.role
    WHERE r.user_id IN ('00000000-0000-4000-a000-00000000ee01', '00000000-0000-4000-a000-00000000ee02', '00000000-0000-4000-a000-00000000ee04', '00000000-0000-4000-a000-00000000ee05')),
  4::bigint, 'the backfill puts one row per staff user for the role the column holds');
SELECT is((SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee02'), 1::bigint,
  'running the backfill again adds nothing');

-- 3. Several roles: the column keeps the highest-priority one ------------------------------------------------------
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-a000-00000000ee02', 'conversion_specialist');
SELECT is((SELECT role FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000ee02'), 'community_manager',
  'community manager + conversion specialist: the column holds community_manager');
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-a000-00000000ee04', 'community_manager');
SELECT is((SELECT role FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000ee04'), 'assistant',
  'assistant + community manager: the column holds assistant');
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-a000-00000000ee02', 'admin');
SELECT is((SELECT role FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000ee02'), 'admin',
  'adding admin moves the column to admin');
DELETE FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee02' AND role = 'admin';
SELECT is((SELECT role FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000ee02'), 'community_manager',
  'removing it moves the column back to the next role held');
SELECT is(public.staff_role_rank('admin') < public.staff_role_rank('assistant')
  AND public.staff_role_rank('assistant') < public.staff_role_rank('community_manager')
  AND public.staff_role_rank('community_manager') < public.staff_role_rank('conversion_specialist'), true,
  'priority: admin, assistant, community manager, conversion specialist');
SELECT is(public.staff_role_rank('member'), NULL::int, 'member has no rank');

-- 4. A direct write of the column means "exactly this role" ---------------------------------------------------------
UPDATE public.user_profiles SET role = 'conversion_specialist' WHERE id = '00000000-0000-4000-a000-00000000ee02';
SELECT is(
  ARRAY(SELECT role FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee02'),
  ARRAY['conversion_specialist'], 'writing the column replaces the set with that one role');
UPDATE public.user_profiles SET role = 'member' WHERE id = '00000000-0000-4000-a000-00000000ee02';
SELECT is((SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee02'), 0::bigint,
  'writing member clears the set');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000ee02', 'community_manager'),
  ('00000000-0000-4000-a000-00000000ee02', 'conversion_specialist');

-- 5. The helpers, over both sources ---------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ee02", "email": "ur-two@example.test", "role": "authenticated"}', true);
SELECT ok(public.is_community_manager(), 'two roles: is_community_manager() is true');
SELECT ok(public.is_conversion_specialist(), 'two roles: is_conversion_specialist() is true');
SELECT ok(NOT public.is_admin(), 'two roles, neither admin: is_admin() stays false');
SELECT ok(NOT public.can_own_care_plans('00000000-0000-4000-a000-00000000ee03'), 'a plain member may not own plans');
SELECT ok(public.can_own_care_plans('00000000-0000-4000-a000-00000000ee04'), 'assistant + community manager may own plans (the column alone says assistant)');
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

-- the single-role assistant: is_admin() is still only the admin role
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ee04", "email": "ur-assist@example.test", "role": "authenticated"}', true);
SELECT ok(NOT public.is_admin(), 'an assistant is not is_admin() (nothing widened)');
SELECT ok(public.is_community_manager(), 'an assistant who is also a community manager is is_community_manager()');

-- 6. Admins read and write all roles; set_user_roles replaces the set as the caller -----------------------------
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ee05", "email": "ur-admin2@example.test", "role": "authenticated"}', true);
SELECT ok(public.is_admin(), 'an admin is is_admin()');
SELECT cmp_ok((SELECT count(*) FROM public.user_roles), '>=', 5::bigint, 'an admin reads every user''s roles');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ee03', ARRAY['community_manager', 'conversion_specialist'])$$,
  'an admin assigns two roles');
SELECT is(
  ARRAY(SELECT role FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee03' ORDER BY role),
  ARRAY['community_manager', 'conversion_specialist'], 'both are stored');
SELECT is((SELECT role FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000ee03'), 'community_manager',
  'and the column holds the primary role');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ee03', ARRAY['conversion_specialist', 'conversion_specialist'])$$,
  'assigning a smaller set removes the rest (duplicates are fine)');
SELECT is(
  ARRAY(SELECT role FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee03'),
  ARRAY['conversion_specialist'], 'one role is left');
SELECT throws_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ee03', ARRAY['superuser'])$$, '22023', NULL, 'an unknown role is refused');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ee03', ARRAY['member'])$$, 'member means no roles');
SELECT is((SELECT role FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000ee03'), 'member', 'the column is member again');
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000ee03', ARRAY['community_manager'])$$, 'assigned once more, for the audit rows');

-- 7. Audit: the entries name the person who assigned --------------------------------------------------------------------
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.audit_log WHERE entity_type = 'user_role' AND action = 'insert' AND actor_kind = 'staff'
     AND changed_by = '00000000-0000-4000-a000-00000000ee05' AND entity_label = 'ur-member@example.test'),
  3::bigint, 'each role given is an entry by the admin, labelled with the account');
SELECT is(
  (SELECT count(*) FROM public.audit_log WHERE entity_type = 'user_role' AND action = 'delete'
     AND changed_by = '00000000-0000-4000-a000-00000000ee05' AND changes -> 'role' ->> 'old' = 'conversion_specialist'),
  1::bigint, 'taking a role away is an entry too');
SELECT is(
  (SELECT count(*) FROM public.audit_log WHERE entity_type = 'user_profile' AND action = 'update'
     AND entity_id = '00000000-0000-4000-a000-00000000ee03'),
  0::bigint, 'the echo on user_profiles.role writes no entry of its own');

-- 8. staff_member_ids() counts a person holding any staff role ----------------------------------------------------------
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_UserRoleAAA1', 'Two Roles', 'ur-two@example.test', now(), 'active', '00000000-0000-4000-a000-00000000ee02'),
  ('mbr_UserRoleAAA2', 'Plain Member', 'ur-plain@example.test', now(), 'active', NULL);
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-a000-00000000ee01', 'community_manager');
SELECT ok('mbr_UserRoleAAA1' IN (SELECT public.staff_member_ids()), 'the member behind a two-role account is staff');
SELECT ok('mbr_UserRoleAAA2' NOT IN (SELECT public.staff_member_ids()), 'an ordinary member is not');
DELETE FROM public.user_roles WHERE user_id = '00000000-0000-4000-a000-00000000ee01' AND role = 'community_manager';

-- 9. The hook: app_roles lists every role, highest first; app_role is the primary one -------------------------------
CREATE TEMP TABLE hook_out ON COMMIT DROP AS
SELECT public.custom_access_token_hook(jsonb_build_object(
  'user_id', '00000000-0000-4000-a000-00000000ee04', 'claims', jsonb_build_object('role', 'authenticated'))) AS result;
SELECT is((SELECT result -> 'claims' -> 'app_roles' FROM hook_out), '["assistant", "community_manager"]'::jsonb,
  'the hook lists the roles in priority order');
SELECT is((SELECT result -> 'claims' ->> 'app_role' FROM hook_out), 'assistant', 'and app_role is the primary role');

SELECT * FROM finish(true);
ROLLBACK;
