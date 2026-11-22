-- pgTAP tests for 20271102000000_user_roles_readers.sql (several roles per user, contract step 1): every reader of
-- user_profiles.role now reads user_roles. For each function that moved: a single-role user gets the same answer as before
-- and a user holding two roles gets the answer for the union; a user whose old column says admin but who holds no
-- user_roles row (the sync triggers are switched off to make one) is NOT treated as admin. A guard scans the database for
-- any other function that reads the column. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(32);

-- g1 admin; g2 assistant; g3 community manager; g4 community manager + conversion specialist; g5 assistant + conversion specialist;
-- g6 member; g7 conversion specialist + admin; g8 conversion specialist only; g9 no profile row.
INSERT INTO auth.users (id, instance_id, aud, role, email)
SELECT ('00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'readers-g' || n || '@example.test'
FROM generate_series(1, 9) AS n;
INSERT INTO public.user_profiles (id, email, role)
SELECT ('00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'))::uuid, 'readers-g' || n || '@example.test', 'member'
FROM generate_series(1, 8) AS n
ON CONFLICT (id) DO UPDATE SET role = 'member';
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
SELECT is(pg_temp.claims_of(1) -> 'app_role', '"admin"'::jsonb, 'hook: an admin''s app_role');
SELECT is(pg_temp.claims_of(1) -> 'app_roles', '["admin"]'::jsonb, 'and app_roles');
SELECT is(pg_temp.claims_of(4) -> 'app_role', '"community_manager"'::jsonb, 'hook: two roles, app_role is the primary one');
SELECT is(pg_temp.claims_of(4) -> 'app_roles', '["community_manager", "conversion_specialist"]'::jsonb, 'and app_roles lists both, highest first');
SELECT is(pg_temp.claims_of(7) -> 'app_roles', '["admin", "conversion_specialist"]'::jsonb, 'whatever order they were given');
SELECT is(pg_temp.claims_of(6) -> 'app_role', '"member"'::jsonb, 'hook: a member');
SELECT is(pg_temp.claims_of(6) -> 'app_roles', '[]'::jsonb, 'holds no roles');
SELECT is(pg_temp.claims_of(9) -> 'app_role', 'null'::jsonb, 'hook: no profile row, app_role is JSON null');
SELECT is(pg_temp.claims_of(9) -> 'app_roles', '[]'::jsonb, 'and no roles');

-- 7. top_role_rank and the last-admin check read user_roles only ------------------------------------------------------------------
SELECT is((SELECT array_agg(public.top_role_rank(('00000000-0000-4000-a000-00000000e0' || lpad(n::text, 2, '0'))::uuid) ORDER BY n) FROM generate_series(1, 8) AS n),
  ARRAY[1, 2, 3, 3, 2, NULL, 1, 4], 'top_role_rank: the highest role held, null for a member');

-- 8. A column that says admin without a user_roles row grants nothing to any moved reader -------------------------------------
ALTER TABLE public.user_profiles DISABLE TRIGGER USER;
UPDATE public.user_profiles SET role = 'admin' WHERE id = '00000000-0000-4000-a000-00000000e006';
ALTER TABLE public.user_profiles ENABLE TRIGGER USER;
SELECT is((SELECT role FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000e006'), 'admin', 'setup: the old column says admin for the member, with no user_roles row');
SELECT ok(NOT public.analytics_is_staff('00000000-0000-4000-a000-00000000e006'), 'analytics_is_staff ignores the column');
SELECT is(pg_temp.claims_of(6) -> 'app_role', '"member"'::jsonb, 'the hook ignores the column');
SELECT is(pg_temp.claims_of(6) -> 'app_roles', '[]'::jsonb, 'for the roles too');
SELECT is(public.top_role_rank('00000000-0000-4000-a000-00000000e006'), NULL::int, 'top_role_rank ignores the column');
SELECT is((SELECT samples FROM public.member_removal_extras('mbr_ReadersAAA6') WHERE item = 'user_profiles'), ARRAY['Profile, role member'], 'member_removal_extras ignores the column');
-- the last-admin rule counts user_roles only: g1 (admin) removes g7's admin role while the only other "admin" is a column
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e001", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT public.set_user_roles('00000000-0000-4000-a000-00000000e007', ARRAY['conversion_specialist'])$$, 'enforce_user_role_changes: removing another admin''s role is fine while an admin (the actor) remains');
RESET ROLE;

-- 9. The guard: no other function, policy or view reads the column --------------------------------------------------------------------
SELECT is(
  ARRAY(SELECT p.proname::text FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
           AND pg_get_functiondef(p.oid) ~* 'user_profiles[^;]*\mrole\M'
         ORDER BY 1),
  ARRAY['create_user_profile', 'sync_profile_role_from_user_roles', 'user_has_any_role'],
  'only the new-profile default, the sync trigger and user_has_any_role''s second source mention user_profiles.role (a new reader must read user_roles)');
SELECT is(
  ARRAY(SELECT policyname::text FROM pg_policies WHERE tablename <> 'user_profiles' AND (coalesce(qual, '') || coalesce(with_check, '')) ~* 'user_profiles' ORDER BY 1),
  ARRAY[]::text[], 'no policy on another table reads user_profiles');
SELECT is(
  ARRAY(SELECT viewname::text FROM pg_views WHERE schemaname IN ('public', 'bronze') AND definition ~* 'user_profiles' ORDER BY 1),
  ARRAY[]::text[], 'no view reads user_profiles');
SELECT is(
  ARRAY(SELECT p.proname::text FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p') AND p.proname NOT IN ('custom_access_token_hook', 'user_has_any_role')
           AND pg_get_functiondef(p.oid) ~* 'user_profiles[^;]*\mrole\M|\m(up|vp|p|prof)\.role\M'
         ORDER BY 1),
  ARRAY['create_user_profile', 'sync_profile_role_from_user_roles'],
  'and no function reads it through an alias');

SELECT * FROM finish(true);
ROLLBACK;
