-- pgTAP guards added by the SECURITY DEFINER review of 2026-11-21 (docs/trust/SECURITY_DEFINER_REVIEW.md). Rolled back;
-- `pnpm test:pgtap`. It sits beside security_guards.test.sql and does not repeat it: that file proves every callable
-- definer function HAS a caller check and a pinned search_path. This one covers what it does not.
--
--   1. No function in public (definer or not, callable or not) lacks a pinned search_path. A later CREATE OR REPLACE
--      without the SET clause silently drops it, and the advisor's function_search_path_mutable then fires.
--   1b. A SECURITY DEFINER function pins `search_path = public, pg_temp` (or an empty one): new ones must; the older
--      ones that do not are on a shrink-only list (decision D2 in the review).
--   2. A callable definer function builds SQL dynamically (EXECUTE, format, query_to_xml, set_config, SET ROLE, quote_*,
--      dblink) only if it is on the reviewed list below. Dynamic SQL in a function that skips row level security is
--      where injection would live, so each one is read by a person: what it is built from, who can call it.
--   3. Caller scoping that no other test pins: one member cannot read or revoke another member's sign-in sessions, and
--      a hostile value cannot change the query member_owned_row_counts builds.
--
-- ADDING A DYNAMIC FUNCTION. If it is deliberate, add one line to `reviewed_dynamic`: the signature as printed here and
-- the reason it is safe (identifiers from the catalog through %I, values through %L or a bound parameter, a fixed key,
-- an admin check first). The test also fails when an entry goes stale.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

-- 1. search_path pinned everywhere in public ---------------------------------------------------------------------
SELECT is(
  ARRAY(SELECT p.oid::regprocedure::text
          FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.prokind IN ('f', 'p')
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
           AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%')
         ORDER BY 1),
  ARRAY[]::text[],
  'every function in public pins its search_path (a CREATE OR REPLACE must repeat the SET clause)');

-- 1b. search_path of a SECURITY DEFINER function names pg_temp (or is empty) -----------------------------------------
-- With `search_path = public` Postgres searches the temporary schema first for tables, so a caller who could create
-- a temp table could shadow one a definer function reads. It is not reachable through PostgREST, and the 80 functions
-- below predate the rule, so they were left as they are on purpose (docs/trust/SECURITY_DEFINER_REVIEW.md, D2). The
-- list only shrinks: a NEW definer function must use `SET search_path = public, pg_temp` (or `""` with every name
-- schema-qualified). A function that is fixed later is removed from the list (the second check fails on a stale entry).
CREATE TEMP TABLE unpinned_temp_allowed (sig text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO unpinned_temp_allowed (sig) VALUES
  ('admin_chat_adoption_people(timestamp with time zone)'),
  ('admin_chat_adoption_weekly(timestamp with time zone,text)'),
  ('audit_row_change()'),
  ('can_open_lesson(text)'),
  ('care_log_messages_read(text)'),
  ('chat_add_message_files(text,jsonb)'),
  ('chat_adopt_posted_file_message()'),
  ('chat_adopt_posted_message()'),
  ('chat_apply_slack_read(text,text,text)'),
  ('chat_can_read_content(text)'),
  ('chat_can_see_channel(text)'),
  ('chat_claim_slack_dm_pull(text,integer)'),
  ('chat_claim_slack_read_pull(text,integer)'),
  ('chat_delete_file(text,text)'),
  ('chat_delete_message(text)'),
  ('chat_dm_apps(text)'),
  ('chat_dm_counterparts(text)'),
  ('chat_dm_in_care_plan(text)'),
  ('chat_edit_message(text,text)'),
  ('chat_is_channel_member(text)'),
  ('chat_mark_message_failed(text)'),
  ('chat_mark_message_sent(text,text)'),
  ('chat_mark_read(text,timestamp with time zone)'),
  ('chat_mark_unread(text,text)'),
  ('chat_post_message(text,text,text,jsonb)'),
  ('chat_post_shared_video(text,text,text,boolean,text,integer)'),
  ('chat_post_shared_video(text,text,text,boolean,text)'),
  ('chat_reactions_set_channel()'),
  ('chat_set_notify_setting(text,text)'),
  ('chat_toggle_reaction(text,text)'),
  ('chat_touch_channel_last_message()'),
  ('chat_unread_channel_ids(text)'),
  ('chat_visible_channel_ids()'),
  ('claim_chat_gap_fill(text,text,text,text,interval)'),
  ('copy_course_lesson_files(text,text)'),
  ('count_activity_feed(boolean,text[],uuid,text,boolean,timestamp with time zone,timestamp with time zone,integer,text[],boolean,boolean)'),
  ('course_address_redirects_guard()'),
  ('courses_address_and_publication()'),
  ('create_user_profile()'),
  ('current_acting_as_member_id()'),
  ('current_member_id()'),
  ('duplicate_course(text)'),
  ('edit_member_admin_note(text,text,integer)'),
  ('get_access_sessions(uuid,integer,integer)'),
  ('get_activity_feed(boolean,text[],uuid,text,boolean,timestamp with time zone,timestamp with time zone,integer,integer,integer,text[],boolean,boolean)'),
  ('get_recent_login_sessions(timestamp with time zone,timestamp with time zone)'),
  ('get_record_history(text[],text,integer,text,boolean)'),
  ('has_course_access(text)'),
  ('is_admin()'),
  ('is_community_manager()'),
  ('is_conversion_specialist()'),
  ('lesson_comments_check_parent()'),
  ('lesson_comments_guard_update()'),
  ('member_owned_row_counts(text)'),
  ('mentorship_counts()'),
  ('moderate_lesson_comment(text,text)'),
  ('move_course_lesson(text,text)'),
  ('my_mentorships(text)'),
  ('prickle_checkins_log_activity()'),
  ('recompute_course_states(text)'),
  ('reorder_course_children(text,text,text,text[])'),
  ('reorder_writing_goals(text,text,text[])'),
  ('reorder_writing_projects(text,text[])'),
  ('revoke_user_sessions(uuid)'),
  ('scrub_restricted_slack_channel_activities()'),
  ('set_course_item_status(text,text,text)'),
  ('set_mentorship_note(uuid,text)'),
  ('slack_bot_token_get()'),
  ('slack_bot_token_save(text,text,timestamp with time zone)'),
  ('slack_connection_delete_secrets(text)'),
  ('slack_connection_revoke(text)'),
  ('slack_connection_save(text,text,text,text[],text,text,timestamp with time zone)'),
  ('slack_connection_tokens(text)'),
  ('slack_connection_update_tokens(text,text,text,timestamp with time zone)'),
  ('slack_token_refresh_claim(text,integer)'),
  ('slack_token_refresh_release(text)'),
  ('staff_member_ids()'),
  ('sync_chat_channel_restricted()'),
  ('sync_member_email_aliases_on_member_email_change()'),
  ('take_over_kajabi_course(text)');

CREATE TEMP TABLE unpinned_temp_fns ON COMMIT DROP AS
SELECT p.oid::regprocedure::text AS sig
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p') AND p.prosecdef
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
                    WHERE c LIKE 'search_path=%' AND (c LIKE '%pg_temp%' OR c = 'search_path=""'));

SELECT is(
  ARRAY(SELECT sig FROM unpinned_temp_fns WHERE sig NOT IN (SELECT sig FROM unpinned_temp_allowed) ORDER BY 1),
  ARRAY[]::text[],
  'a new SECURITY DEFINER function pins search_path = public, pg_temp (or an empty one); only the listed older ones do not');
SELECT is(
  ARRAY(SELECT sig FROM unpinned_temp_allowed WHERE sig NOT IN (SELECT sig FROM unpinned_temp_fns) ORDER BY 1),
  ARRAY[]::text[],
  'every function on the older-functions list still lacks pg_temp (remove the ones that were fixed or dropped)');

-- 2. Dynamic SQL in callable definer functions ---------------------------------------------------------------------
CREATE TEMP TABLE reviewed_dynamic (sig text PRIMARY KEY, reason text NOT NULL) ON COMMIT DROP;
INSERT INTO reviewed_dynamic (sig, reason) VALUES
  ('duplicate_course(text)',
   'only set_config(''app.audit_skip_course'', <new course id>, true): a fixed key, a value the function generates, transaction-local; admin or service role only (reviewed 2026-11-21)'),
  ('member_owned_row_counts(text)',
   'format(%I, %I, %L) with table and column names read from pg_constraint and the member id quoted as a literal; admin or service role checked first (reviewed 2026-11-21)');

CREATE TEMP TABLE dynamic_fns ON COMMIT DROP AS
SELECT p.oid::regprocedure::text AS sig
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
   AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
   AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~*
       ('\y(execute|format|query_to_xml|query_to_xml_and_xmlschema|set_config|quote_ident|quote_literal|quote_nullable|dblink|dblink_exec)\s*[(]'
        || '|\yexecute\s'
        || '|\yset\s+(session\s+|local\s+)?(role|session\s+authorization)\y');

SELECT is(
  ARRAY(SELECT sig FROM dynamic_fns WHERE sig NOT IN (SELECT sig FROM reviewed_dynamic) ORDER BY 1),
  ARRAY[]::text[],
  'every callable SECURITY DEFINER function that builds SQL dynamically is on the reviewed list');

SELECT is(
  ARRAY(SELECT sig FROM reviewed_dynamic WHERE sig NOT IN (SELECT sig FROM dynamic_fns) ORDER BY 1),
  ARRAY[]::text[],
  'every reviewed dynamic function is still a callable SECURITY DEFINER function that builds SQL dynamically (remove stale entries)');

-- 3. Caller scoping --------------------------------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d0a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-ada@example.test'),
  ('00000000-0000-4000-a000-00000000d0a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-bea@example.test'),
  ('00000000-0000-4000-a000-00000000d0a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-admin@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000d0a1', 'review-ada@example.test'),
  ('00000000-0000-4000-a000-00000000d0a2', 'review-bea@example.test'),
  ('00000000-0000-4000-a000-00000000d0a3', 'review-admin@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000d0a3', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO auth.sessions (id, user_id) VALUES
  ('00000000-0000-4000-a000-0000000051a1', '00000000-0000-4000-a000-00000000d0a1'),
  ('00000000-0000-4000-a000-0000000051b1', '00000000-0000-4000-a000-00000000d0a2');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d0a1", "email": "review-ada@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'ada_sees', to_jsonb(array_agg(id::text ORDER BY id)) FROM public.get_my_sessions();
INSERT INTO result SELECT 'ada_revokes_bea', to_jsonb(public.revoke_my_session('00000000-0000-4000-a000-0000000051b1'));
INSERT INTO result SELECT 'ada_revokes_own', to_jsonb(public.revoke_my_session('00000000-0000-4000-a000-0000000051a1'));

-- An admin asking about a value built to break out of a quoted literal gets no rows and no error.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d0a3", "email": "review-admin@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'hostile_member_id', to_jsonb(count(*))
  FROM public.member_owned_row_counts($q$mbr_x' OR '1'='1'; DROP TABLE public.members; --$q$);

RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'ada_sees'), '["00000000-0000-4000-a000-0000000051a1"]'::jsonb,
  'a member lists only their own sign-in sessions');
SELECT is((SELECT value FROM result WHERE label = 'ada_revokes_bea'), 'false'::jsonb,
  'revoking another member''s session reports nothing revoked');
SELECT is(
  (SELECT value FROM result WHERE label = 'ada_revokes_own') = 'true'::jsonb
    AND EXISTS (SELECT 1 FROM auth.sessions WHERE id = '00000000-0000-4000-a000-0000000051b1')
    AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = '00000000-0000-4000-a000-0000000051a1'),
  true,
  'a member revokes their own session and the other member''s session is still there');
SELECT is((SELECT value FROM result WHERE label = 'hostile_member_id'), '0'::jsonb,
  'member_owned_row_counts treats a hostile member id as plain text (no rows, no error, members table intact)');

SELECT * FROM finish(true);
ROLLBACK;
