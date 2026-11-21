-- pgTAP guards for the database's security baseline. Rolled back; `pnpm test:pgtap`.
--
--   1. Every table in public and bronze has row level security enabled.
--   2. Every SECURITY DEFINER function in public that a signed-in or signed-out caller can execute
--      has a recognizable caller check in its body, or is in the reviewed-exceptions list below.
--   3. Every such function pins its search_path, and the signed-out role can run only is_admin().
--
-- WHAT THIS PROVES, AND WHAT IT DOES NOT. Guard 2 proves that a check EXISTS in the function (its body names
-- auth.uid(), is_admin(), current_member_id() or a helper that wraps them). It does not prove the check is
-- correct, complete or on every path. A human still reads every new SECURITY DEFINER function in the PR that
-- adds it: what it reads or writes, who can call it, and whether it checks the caller before touching data.
--
-- ADDING AN EXCEPTION. A new function with no recognizable check fails guard 2. If it is deliberate (it
-- returns data that is meant for every signed-in member, or it only delegates to a function that checks),
-- add one line to `reviewed_exceptions` below: the signature as printed here, a one-line reason, and who
-- reviewed it in which PR. Prefer adding a check instead. The test also fails when an exception goes stale
-- (the function is gone, no longer executable by a caller, or now has a recognized check), so the list stays
-- honest. See docs/trust/RLS_SECURITY.md, "Security definer functions".
--
-- Deliberate reads of other members' data that DO pass the recognized-check test, so need no exception, but
-- were reviewed on 2026-11-18: get_profile_writing (returns only items the member marked show_on_profile, for
-- the member asked about, and nothing without a signed-in caller) and get_member_directory.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(11);

-- 1. Row level security on every table --------------------------------------------------------------------
SELECT isnt(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'bronze') AND c.relkind IN ('r', 'p')),
  0, 'there are tables in public and bronze to check');

SELECT is(
  ARRAY(SELECT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('public', 'bronze') AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
         ORDER BY 1),
  ARRAY[]::text[],
  'every table in public and bronze has row level security enabled (enable it in the migration that creates the table)');

-- 2. Definer functions that callers can run -----------------------------------------------------------------
CREATE TEMP TABLE definer_fns ON COMMIT DROP AS
SELECT p.oid,
       p.oid::regprocedure::text AS sig,
       p.proname,
       p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can,
       -- the body with SQL line comments removed, so a comment cannot satisfy the check
       regexp_replace(p.prosrc, '--[^\n]*', '', 'g') AS body
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- The caller checks we recognize: the primitives that read the caller from the request, and the helpers that
-- wrap them (each helper is itself asserted below).
CREATE TEMP TABLE recognized ON COMMIT DROP AS
SELECT '(auth\.uid\(|auth\.role\(|auth\.jwt\(|is_admin\(|is_community_manager\(|current_member_id\(|current_acting_as_member_id\('
    || '|has_course_access\(|can_open_lesson\(|chat_is_channel_member\(|chat_can_read_content\(|chat_can_see_channel\('
    || '|chat_visible_channel_ids\(|can_own_care_plans\()' AS re;

-- Reviewed exceptions: callable definer functions with no recognizable check in their own body.
CREATE TEMP TABLE reviewed_exceptions (sig text PRIMARY KEY, reason text NOT NULL) ON COMMIT DROP;
INSERT INTO reviewed_exceptions (sig, reason) VALUES
  ('chat_post_shared_video(text,text,text,boolean,text)',
   'one-line wrapper that calls the six-argument version, which checks the member, the lesson and course access (reviewed 2026-11-18)'),
  ('member_directory_aliases()',
   'returns aliases of directory-visible members only, via the searchable aliases view joined to member_directory; anon cannot run it (reviewed 2026-11-18)'),
  ('search_member_aliases(text)',
   'same rows as member_directory_aliases, filtered by a search term and capped; anon cannot run it (reviewed 2026-11-18)'),
  ('mentorship_counts()',
   'per-mentor aggregate match counts and first/last dates; deliberate because members cannot read the mentorships table and badges need it; anon cannot run it (reviewed 2026-11-18)');

SELECT is(
  ARRAY(SELECT f.sig FROM definer_fns f, recognized r
         WHERE f.body !~* r.re AND f.sig NOT IN (SELECT sig FROM reviewed_exceptions)
         ORDER BY 1),
  ARRAY[]::text[],
  'every callable SECURITY DEFINER function in public has a recognizable caller check or a reviewed exception');

SELECT is(
  ARRAY(SELECT e.sig FROM reviewed_exceptions e
         WHERE NOT EXISTS (SELECT 1 FROM definer_fns f WHERE f.sig = e.sig)
         ORDER BY 1),
  ARRAY[]::text[],
  'every reviewed exception still names a callable SECURITY DEFINER function (remove stale entries)');

SELECT is(
  ARRAY(SELECT f.sig FROM definer_fns f, recognized r, reviewed_exceptions e
         WHERE f.sig = e.sig AND f.body ~* r.re ORDER BY 1),
  ARRAY[]::text[],
  'no reviewed exception now has a recognized check (remove entries that no longer need one)');

-- The helpers the list leans on must exist, be definer functions, and themselves check the caller.
SELECT is(
  ARRAY(SELECT h FROM unnest(ARRAY[
      'is_admin()', 'is_community_manager()', 'current_member_id()', 'current_acting_as_member_id()',
      'has_course_access(text)', 'can_open_lesson(text)', 'chat_is_channel_member(text)',
      'chat_can_read_content(text)', 'chat_can_see_channel(text)', 'chat_visible_channel_ids()',
      'can_own_care_plans(uuid)']) AS h
         WHERE NOT EXISTS (SELECT 1 FROM definer_fns f WHERE f.sig = h)
         ORDER BY 1),
  ARRAY[]::text[],
  'every helper named in the recognized checks exists as a callable SECURITY DEFINER function');

SELECT is(
  ARRAY(SELECT f.sig FROM definer_fns f
         WHERE f.sig IN ('is_admin()', 'is_community_manager()', 'current_member_id()', 'current_acting_as_member_id()')
           AND f.body !~* 'auth\.(uid|role|jwt)\('
         ORDER BY 1),
  ARRAY[]::text[],
  'the four base helpers read the caller from the request (auth.uid, auth.role or auth.jwt)');

SELECT is(
  ARRAY(SELECT f.sig FROM definer_fns f
         WHERE f.sig IN ('has_course_access(text)', 'can_open_lesson(text)', 'chat_is_channel_member(text)',
                         'chat_can_read_content(text)', 'chat_can_see_channel(text)', 'chat_visible_channel_ids()',
                         'can_own_care_plans(uuid)')
           AND f.body !~* '(auth\.uid\(|is_admin\(|is_community_manager\(|current_member_id\(|has_course_access\(|chat_is_channel_member\()'
         ORDER BY 1),
  ARRAY[]::text[],
  'the wrapping helpers are built on the base helpers');

-- 3. search_path and signed-out access ------------------------------------------------------------------------
SELECT is(
  ARRAY(SELECT f.sig FROM definer_fns f
         WHERE NOT EXISTS (SELECT 1 FROM unnest(coalesce(f.proconfig, ARRAY[]::text[])) AS c WHERE c LIKE 'search_path=%')
         ORDER BY 1),
  ARRAY[]::text[],
  'every callable SECURITY DEFINER function in public sets its search_path');

SELECT is(
  ARRAY(SELECT f.sig FROM definer_fns f WHERE f.anon_can ORDER BY 1),
  ARRAY['is_admin()'],
  'the signed-out role can run exactly one SECURITY DEFINER function: is_admin()');

SELECT ok(
  (SELECT count(*) FROM definer_fns WHERE authenticated_can) > 40,
  'signed-in users can run the SECURITY DEFINER functions the app relies on');

SELECT * FROM finish(true);
ROLLBACK;
