-- pgTAP guards added by the SECURITY DEFINER review of 2026-11-21 (docs/trust/SECURITY_DEFINER_REVIEW.md). Rolled back;
-- `pnpm test:pgtap`. It sits beside security_guards.test.sql and does not repeat it: that file proves every callable
-- definer function HAS a caller check and a pinned search_path. This one covers what it does not.
--
--   1. No function in public (definer or not, callable or not) lacks a pinned search_path. A later CREATE OR REPLACE
--      without the SET clause silently drops it, and the advisor's function_search_path_mutable then fires.
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

SELECT plan(7);

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
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000d0a1', 'review-ada@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000d0a2', 'review-bea@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000d0a3', 'review-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
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
