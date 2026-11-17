-- pgTAP tests for the caller check of the course functions fixed in 20270813000000 (and
-- reorder_course_children in 20270810000000): `IF NOT (is_admin() OR auth.role() = 'service_role')` was NULL, so
-- it did not raise, for a caller whose claims carry no role. Each function now refuses such a caller, and still
-- lets the service role (the server itself) through. Runs in one transaction that is rolled back, so it leaves
-- the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(24);

-- One Hub-owned course with two lessons, so the functions that get past the check have something to act on.
INSERT INTO public.courses (id, slug, title, source, source_key) VALUES
  ('crs_NullGuard001', 'pgtap-null-guard', 'Null Guard Course', 'hub', NULL);
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, state, body_html, source, source_key) VALUES
  ('les_NullGuardA01', 'crs_NullGuard001', NULL, 'Lesson A', 1, 'hidden', '<p>a</p>', 'hub', NULL),
  ('les_NullGuardB01', 'crs_NullGuard001', NULL, 'Lesson B', 2, 'hidden', '<p>b</p>', 'hub', NULL);

CREATE TEMP TABLE cases (fn text, call_sql text, refused text, allowed text) ON COMMIT DROP;
INSERT INTO cases VALUES
  ('move_course_lesson', $$SELECT public.move_course_lesson('les_NoSuchLesson1', NULL)$$, 'not_editable', 'not_found'),
  ('take_over_kajabi_course', $$SELECT public.take_over_kajabi_course('crs_NoSuchCourse1')$$, 'not_editable', 'not_found'),
  ('copy_course_lesson_files', $$SELECT public.copy_course_lesson_files('les_NullGuardA01', 'les_NullGuardB01')$$, 'not_editable', 'ok'),
  ('duplicate_course', $$SELECT public.duplicate_course('crs_NoSuchCourse1')$$, 'not_editable', 'not_found'),
  ('set_course_item_status', $$SELECT public.set_course_item_status('bogus', 'x', 'draft')$$, 'not_editable', 'unknown_kind'),
  ('moderate_lesson_comment', $$SELECT public.moderate_lesson_comment('x', 'bogus')$$, 'not_allowed', 'unknown_action');
GRANT SELECT ON cases TO authenticated;

CREATE TEMP TABLE result(label text, expected text, actual text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- What a statement ended with: 'ok', or the message it was refused with.
CREATE FUNCTION pg_temp.attempt(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.attempt(text) TO authenticated;

SET LOCAL ROLE authenticated;

-- No claims at all: auth.role() and auth.uid() are NULL.
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO result SELECT fn || ': no claims', refused, pg_temp.attempt(call_sql) FROM cases;

-- A user with no profile row and no role claim: the same NULL.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1ff", "email": "nullguard-ghost@example.test"}', true);
INSERT INTO result SELECT fn || ': no role claim', refused, pg_temp.attempt(call_sql) FROM cases;

-- A signed-in user with no profile row.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1ff", "email": "nullguard-ghost@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT fn || ': no profile', refused, pg_temp.attempt(call_sql) FROM cases;

-- The server itself (the service role) is let through: it gets past the check and meets the function's own rules.
SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
INSERT INTO result SELECT fn || ': service role', allowed, pg_temp.attempt(call_sql) FROM cases;

RESET ROLE;

SELECT is(actual, expected, label) FROM result ORDER BY label;

SELECT * FROM finish(true);
ROLLBACK;
