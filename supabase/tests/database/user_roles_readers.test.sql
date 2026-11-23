-- pgTAP tests for the functions that read a person's roles from user_roles (20271102000000_user_roles_readers.sql; the old
-- user_profiles.role column is dropped in 20271110000000). For each function: a single-role user gets the answer they always did and a
-- user holding two roles gets the answer for the union. A guard scans the database for any function, policy or view that still reads a
-- role column of user_profiles (there is none: the column is gone). Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(22);

-- g1 admin; g2 assistant; g3 community manager; g4 community manager + conversion specialist; g5 assistant + conversion specialist;
-- g6 member; g7 conversion specialist + admin; g8 conversion specialist only; g9 no profile row.
INSERT INTO auth.users (id, instance_id, aud, role, email)
SELECT ('00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'readers-g' || n || '@example.test'
FROM generate_series(1, 9) AS n;
INSERT INTO public.user_profiles (id, email)
SELECT ('00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'))::uuid, 'readers-g' || n || '@example.test'
FROM generate_series(1, 8) AS n
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000e009';

INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000e001', 'admin'),
  ('00000000-0000-4000-a000-00000000e002', 'assistant'),
  ('00000000-0000-4000-a000-00000000e003', 'community_manager'),
  ('00000000-0000-4000-a000-00000000e004', 'community_manager'),
  ('00000000-0000-4000-a000-00000000e004', 'conversion_specialist'),
  ('00000000-0000-4000-a000-00000000e005', 'assistant'),
  ('00000000-0000-4000-a000-00000000e005', 'conversion_specialist'),
  ('00000000-0000-4000-a000-00000000e007', 'conversion_specialist'),
  ('00000000-0000-4000-a000-00000000e007', 'admin'),
  ('00000000-0000-4000-a000-00000000e008', 'conversion_specialist');

-- 1. analytics_is_staff: admin among the roles, nothing else -----------------------------------------------------------
SELECT is(
  (SELECT array_agg(n ORDER BY n) FROM generate_series(1, 9) AS n
    WHERE public.analytics_is_staff(('00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'))::uuid)),
  ARRAY[1, 7], 'analytics_is_staff: the admin and the person who holds admin among two roles, no one else');

-- 2. get_activity_feed: a visit by someone holding admin or assistant is a staff visit ------------------------------------
INSERT INTO public.access_events (user_id, path, is_page, created_at)
SELECT ('00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'))::uuid, '/dashboard', true, now() - interval '2 minutes'
FROM generate_series(1, 8) AS n;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e001", "role": "authenticated"}', true);
CREATE TEMP TABLE visits ON COMMIT DROP AS
SELECT actor_user_id, actor_kind
FROM public.get_activity_feed(false, ARRAY['session'], NULL, NULL, false, now() - interval '1 hour', now() + interval '1 minute', 0, 500)
WHERE actor_user_id::text LIKE '00000000-0000-4000-a000-00000000e0%';
RESET ROLE;
SELECT is(
  (SELECT array_agg(right(actor_user_id::text, 1)::int ORDER BY actor_user_id) FROM visits WHERE actor_kind = 'staff'),
  ARRAY[1, 2, 5, 7], 'get_activity_feed: visits by an admin, an assistant, assistant + specialist and specialist + admin are staff visits');
SELECT is(
  (SELECT array_agg(right(actor_user_id::text, 1)::int ORDER BY actor_user_id) FROM visits WHERE actor_kind = 'member'),
  ARRAY[3, 4, 6, 8], 'and a community manager, community manager + specialist, a member and a specialist are not');

-- 3. reorder_writing_projects: the audit entry says staff for admin, assistant or community manager among the roles --------
INSERT INTO public.members (id, name, email, joined_at, status, user_id)
SELECT 'mbr_ReadersAAA' || n, 'Readers ' || n, 'readers-m' || n || '@example.test', now(), 'active', ('00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'))::uuid
FROM generate_series(1, 8) AS n;
INSERT INTO public.writing_projects (id, member_id, title)
SELECT 'prj_ReadersP' || n || x, 'mbr_ReadersAAA' || n, 'Project ' || x
FROM generate_series(1, 8) AS n, unnest(ARRAY['A', 'B']) AS x;
DO $$
DECLARE n int;
BEGIN
  FOR n IN 1..8 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.reorder_writing_projects('mbr_ReadersAAA' || n, ARRAY['prj_ReadersP' || n || 'A', 'prj_ReadersP' || n || 'B']);
    RESET ROLE;
  END LOOP;
END $$;
SELECT is(
  (SELECT array_agg(right(changed_by::text, 1)::int ORDER BY changed_by) FROM public.audit_log
    WHERE entity_type = 'writing_project_order' AND actor_kind = 'staff' AND changed_by::text LIKE '00000000-0000-4000-a000-00000000e0%'),
  ARRAY[1, 2, 3, 4, 5, 7], 'reorder_writing_projects: staff entries for admin, assistant, community manager (alone or with another role) and specialist + admin');
SELECT is(
  (SELECT array_agg(right(changed_by::text, 1)::int ORDER BY changed_by) FROM public.audit_log
    WHERE entity_type = 'writing_project_order' AND actor_kind = 'member' AND changed_by::text LIKE '00000000-0000-4000-a000-00000000e0%'),
  ARRAY[6, 8], 'and member entries for a member and a conversion specialist alone');

-- 4. reorder_writing_goals: the same actor kind ------------------------------------------------------------------------------
INSERT INTO public.writing_goals (id, member_id, project_id, measure, target_amount)
SELECT ('00000000-0000-4000-b0' || lpad(n::text, 2, '0') || '-000000000001')::uuid, 'mbr_ReadersAAA' || n, 'prj_ReadersP' || n || 'A', 'words', 100 FROM generate_series(1, 8) AS n;
INSERT INTO public.writing_goals (id, member_id, project_id, measure, target_amount)
SELECT ('00000000-0000-4000-b0' || lpad(n::text, 2, '0') || '-000000000002')::uuid, 'mbr_ReadersAAA' || n, 'prj_ReadersP' || n || 'A', 'words', 100 FROM generate_series(1, 8) AS n;
DO $$
DECLARE n int;
BEGIN
  FOR n IN 1..8 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.reorder_writing_goals('mbr_ReadersAAA' || n, 'prj_ReadersP' || n || 'A', ARRAY[
      ('00000000-0000-4000-b0' || lpad(n::text, 2, '0') || '-000000000002')::text, ('00000000-0000-4000-b0' || lpad(n::text, 2, '0') || '-000000000001')::text]);
    RESET ROLE;
  END LOOP;
END $$;
SELECT is(
  (SELECT array_agg(right(changed_by::text, 1)::int ORDER BY changed_by) FROM public.audit_log
    WHERE entity_type = 'writing_goal_order' AND actor_kind = 'staff' AND changed_by::text LIKE '00000000-0000-4000-a000-00000000e0%'),
  ARRAY[1, 2, 3, 4, 5, 7], 'reorder_writing_goals: staff entries for admin, assistant and community manager among the roles');
SELECT is(
  (SELECT array_agg(right(changed_by::text, 1)::int ORDER BY changed_by) FROM public.audit_log
    WHERE entity_type = 'writing_goal_order' AND actor_kind = 'member' AND changed_by::text LIKE '00000000-0000-4000-a000-00000000e0%'),
  ARRAY[6, 8], 'and member entries for a member and a conversion specialist alone');

-- 5. member_removal_extras names the primary role of the profile it would delete ---------------------------------------------
SELECT is((SELECT samples FROM public.member_removal_extras('mbr_ReadersAAA1') WHERE item = 'user_profiles'), ARRAY['Profile, role admin'], 'member_removal_extras: an admin');
SELECT is((SELECT samples FROM public.member_removal_extras('mbr_ReadersAAA4') WHERE item = 'user_profiles'), ARRAY['Profile, role community_manager'], 'two roles: the highest priority one');
SELECT is((SELECT samples FROM public.member_removal_extras('mbr_ReadersAAA5') WHERE item = 'user_profiles'), ARRAY['Profile, role assistant'], 'assistant + specialist: assistant');
SELECT is((SELECT samples FROM public.member_removal_extras('mbr_ReadersAAA6') WHERE item = 'user_profiles'), ARRAY['Profile, role member'], 'a member with no roles: member');

-- 6. The access token hook: app_role is the primary role, app_roles every role, from user_roles ------------------------------
CREATE FUNCTION pg_temp.claims_of(n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.custom_access_token_hook(jsonb_build_object('user_id', ('00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'))::uuid, 'claims', jsonb_build_object('role', 'authenticated'))) -> 'claims'
$$;
SELECT is(pg_temp.claims_of(1) -> 'app_roles', '["admin"]'::jsonb, 'and app_roles');
SELECT is(pg_temp.claims_of(4) -> 'app_roles', '["community_manager", "conversion_specialist"]'::jsonb, 'and app_roles lists both, highest first');
SELECT is(pg_temp.claims_of(7) -> 'app_roles', '["admin", "conversion_specialist"]'::jsonb, 'whatever order they were given');
SELECT is(pg_temp.claims_of(6) -> 'app_roles', '[]'::jsonb, 'holds no roles');
SELECT ok(NOT (pg_temp.claims_of(1) ? 'app_role'), 'hook: the single app_role claim is gone');
SELECT is(pg_temp.claims_of(9) -> 'app_roles', '[]'::jsonb, 'and no roles');

-- 7. top_role_rank and the last-admin check read user_roles only ------------------------------------------------------------------
SELECT is((SELECT array_agg(public.top_role_rank(('00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'))::uuid) ORDER BY n) FROM generate_series(1, 8) AS n),
  ARRAY[1, 2, 3, 3, 2, NULL, 1, 4], 'top_role_rank: the highest role held, null for a member');

-- 8. The guard: no function, policy or view reads a role column of user_profiles ------------------------------------------------------------
SELECT hasnt_column('public', 'user_profiles', 'role', 'the old column is gone');
SELECT is(
  ARRAY(SELECT p.proname::text FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
           AND pg_get_functiondef(p.oid) ~* 'user_profiles[^;]*\mrole\M|\m(up|vp|prof)\.role\M'
         ORDER BY 1),
  ARRAY[]::text[], 'no function reads user_profiles.role (a new reader must read user_roles)');
SELECT is(
  ARRAY(SELECT policyname::text FROM pg_policies WHERE tablename <> 'user_profiles' AND (coalesce(qual, '') || coalesce(with_check, '')) ~* 'user_profiles' ORDER BY 1),
  ARRAY[]::text[], 'no policy on another table reads user_profiles');
SELECT is(
  ARRAY(SELECT viewname::text FROM pg_views WHERE schemaname IN ('public', 'bronze') AND definition ~* 'user_profiles' ORDER BY 1),
  ARRAY[]::text[], 'no view reads user_profiles');

SELECT * FROM finish(true);
ROLLBACK;
