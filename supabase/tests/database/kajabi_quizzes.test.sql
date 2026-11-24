-- pgTAP tests for 20271124400000_kajabi_quizzes.sql: the Silver step for an imported quiz (sync_imported_quiz) and that taking
-- a course over from Kajabi keeps its quizzes and makes them editable.
--   * the quiz of a Kajabi lesson is created with its questions and options on their Kajabi keys
--   * syncing the same payload again changes nothing (ids, order and the rows' own timestamps stay), and a member's attempt
--     still points at the same question
--   * a changed payload updates in place; a question or option Kajabi dropped goes (the answers to it with it, the attempt stays)
--   * a lesson that isn't Kajabi's (a Hub-owned one, or one taken over) is skipped and left as it is
--   * the function is for the service role: a signed-in admin can't call it
--   * after take-over an admin edits the formerly imported quiz; before it they couldn't
--   * the Bronze table is admin read, service role write
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(23);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000d02a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kq-alice@example.test'),
  ('00000000-0000-4000-a000-0000000d02a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kq-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-0000000d02a1', 'kq-alice@example.test'),
  ('00000000-0000-4000-a000-0000000d02a4', 'kq-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-a000-0000000d02a4', 'admin') ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAKqA1', 'Kajabi Quiz Alice', 'kq-alice@example.test', now(), 'active', '00000000-0000-4000-a000-0000000d02a1');

INSERT INTO public.courses (id, slug, title, source, source_key) VALUES
  ('crs_AAAAAAAAKqC1', 'pgtap-kq-kajabi', 'Imported', 'kajabi', 'pgtap-kq-k'),
  ('crs_AAAAAAAAKqC2', 'pgtap-kq-hub', 'Hub', 'hub', NULL);
INSERT INTO public.course_lessons (id, course_id, title, position, state, source, source_key, publishing_option) VALUES
  ('les_AAAAAAAAKqL1', 'crs_AAAAAAAAKqC1', 'Let''s Check In', 1, 'open', 'kajabi', 'pgtap-kq-l1', 'published'),
  ('les_AAAAAAAAKqL2', 'crs_AAAAAAAAKqC2', 'Hub lesson', 1, 'open', 'hub', NULL, 'published');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated;

-- What the capture of the sample quiz reads as: three questions, no passing grade.
CREATE TEMP TABLE payload(name text PRIMARY KEY, body jsonb) ON COMMIT DROP;
INSERT INTO payload VALUES ('first', $json$
{"source_key": "1573355", "passing_percent": null, "hide_answers": true, "questions": [
  {"source_key": "q1", "prompt": "How do you feel?", "allows_multiple": false, "options": [
    {"source_key": "q1a", "label": "Great", "is_correct": false}, {"source_key": "q1b", "label": "Fine", "is_correct": true}]},
  {"source_key": "q2", "prompt": "Which are true?", "allows_multiple": false, "options": [
    {"source_key": "q2a", "label": "A", "is_correct": false}, {"source_key": "q2b", "label": "B", "is_correct": false}, {"source_key": "q2c", "label": "Both B and C", "is_correct": true}]},
  {"source_key": "q3", "prompt": "Pick the writing days", "allows_multiple": true, "options": [
    {"source_key": "q3a", "label": "Monday", "is_correct": true}, {"source_key": "q3b", "label": "Tuesday", "is_correct": false}]}
]}
$json$);
INSERT INTO payload VALUES ('changed', $json$
{"source_key": "1573355", "passing_percent": 80, "hide_answers": false, "questions": [
  {"source_key": "q2", "prompt": "Which are true?", "allows_multiple": false, "options": [
    {"source_key": "q2a", "label": "A", "is_correct": false}, {"source_key": "q2c", "label": "Both B and C, in fact", "is_correct": true}]},
  {"source_key": "q1", "prompt": "How do you feel today?", "allows_multiple": false, "options": [
    {"source_key": "q1a", "label": "Great", "is_correct": false}, {"source_key": "q1b", "label": "Fine", "is_correct": true}]}
]}
$json$);

-- First sync, as the service role (the database owner here).
INSERT INTO result SELECT 'first_sync', public.sync_imported_quiz('les_AAAAAAAAKqL1', (SELECT body FROM payload WHERE name = 'first'));
CREATE TEMP TABLE ids ON COMMIT DROP AS
  SELECT (SELECT id FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAKqL1') AS quiz,
         (SELECT id FROM public.quiz_questions WHERE source_key = 'q1' AND quiz_id = (SELECT id FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAKqL1')) AS q1,
         (SELECT id FROM public.quiz_questions WHERE source_key = 'q3' AND quiz_id = (SELECT id FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAKqL1')) AS q3,
         (SELECT o.id FROM public.quiz_options o JOIN public.quiz_questions q ON q.id = o.question_id WHERE o.source_key = 'q1b' AND q.source_key = 'q1') AS q1b;
INSERT INTO result SELECT 'quiz_row', to_jsonb(coalesce(passing_percent::text, 'none') || ':' || hide_answers || ':' || source_key) FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAKqL1';
INSERT INTO result SELECT 'questions', to_jsonb(array_agg(prompt || ':' || allows_multiple ORDER BY position)) FROM public.quiz_questions WHERE quiz_id = (SELECT quiz FROM ids);
INSERT INTO result SELECT 'right_answers', to_jsonb(array_agg(o.label ORDER BY q.position, o.position)) FROM public.quiz_options o JOIN public.quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = (SELECT quiz FROM ids) AND o.is_correct;
-- Where the rows live: an UPDATE moves a row to a new place, so unchanged places mean nothing was rewritten.
CREATE TEMP TABLE stamp AS SELECT
  (SELECT array_agg(ctid::text ORDER BY id) FROM public.quiz_questions WHERE quiz_id = (SELECT quiz FROM ids)) AS q_places,
  (SELECT array_agg(o.ctid::text ORDER BY o.id) FROM public.quiz_options o JOIN public.quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = (SELECT quiz FROM ids)) AS o_places,
  (SELECT ctid::text FROM public.quizzes WHERE id = (SELECT quiz FROM ids)) AS quiz_place;

-- A member's attempt, answering question 1.
INSERT INTO public.quiz_attempts (id, quiz_id, member_id, question_count, correct_count, score_percent, passed) VALUES ('qatt_AAAAAAAAKq01', (SELECT quiz FROM ids), 'mbr_AAAAAAAAKqA1', 3, 1, 33, true);
INSERT INTO public.quiz_attempt_answers (attempt_id, question_id, selected_option_ids, is_correct) VALUES
  ('qatt_AAAAAAAAKq01', (SELECT q1 FROM ids), ARRAY[(SELECT q1b FROM ids)], true),
  ('qatt_AAAAAAAAKq01', (SELECT q3 FROM ids), '{}', false);

-- The same payload again: nothing changes.
INSERT INTO result SELECT 'second_sync', public.sync_imported_quiz('les_AAAAAAAAKqL1', (SELECT body FROM payload WHERE name = 'first'));
INSERT INTO result SELECT 'same_ids', to_jsonb((SELECT id FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAKqL1') = (SELECT quiz FROM ids)
  AND (SELECT id FROM public.quiz_questions WHERE quiz_id = (SELECT quiz FROM ids) AND source_key = 'q1') = (SELECT q1 FROM ids));
INSERT INTO result SELECT 'untouched', to_jsonb((SELECT array_agg(ctid::text ORDER BY id) FROM public.quiz_questions WHERE quiz_id = (SELECT quiz FROM ids)) = (SELECT q_places FROM stamp)
  AND (SELECT array_agg(o.ctid::text ORDER BY o.id) FROM public.quiz_options o JOIN public.quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = (SELECT quiz FROM ids)) = (SELECT o_places FROM stamp)
  AND (SELECT ctid::text FROM public.quizzes WHERE id = (SELECT quiz FROM ids)) = (SELECT quiz_place FROM stamp));
INSERT INTO result SELECT 'counts_after_repeat', to_jsonb((SELECT count(*) FROM public.quiz_questions WHERE quiz_id = (SELECT quiz FROM ids)) * 100 + (SELECT count(*) FROM public.quiz_options o JOIN public.quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = (SELECT quiz FROM ids)));

-- A changed payload: updates in place, drops question 3 and option q2b, reorders.
INSERT INTO result SELECT 'changed_sync', public.sync_imported_quiz('les_AAAAAAAAKqL1', (SELECT body FROM payload WHERE name = 'changed'));
INSERT INTO result SELECT 'changed_quiz_row', to_jsonb(coalesce(passing_percent::text, 'none') || ':' || hide_answers) FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAKqL1';
INSERT INTO result SELECT 'changed_questions', to_jsonb(array_agg(prompt ORDER BY position)) FROM public.quiz_questions WHERE quiz_id = (SELECT quiz FROM ids);
INSERT INTO result SELECT 'changed_options', to_jsonb(array_agg(o.label ORDER BY q.position, o.position)) FROM public.quiz_options o JOIN public.quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = (SELECT quiz FROM ids);
INSERT INTO result SELECT 'question_kept_id', to_jsonb((SELECT id FROM public.quiz_questions WHERE quiz_id = (SELECT quiz FROM ids) AND source_key = 'q1') = (SELECT q1 FROM ids));
INSERT INTO result SELECT 'attempt_survives', to_jsonb((SELECT count(*) FROM public.quiz_attempts WHERE id = 'qatt_AAAAAAAAKq01') * 10 + (SELECT count(*) FROM public.quiz_attempt_answers WHERE attempt_id = 'qatt_AAAAAAAAKq01'));

-- A lesson that isn't Kajabi's, and one that isn't there, are skipped.
INSERT INTO result SELECT 'hub_skipped', public.sync_imported_quiz('les_AAAAAAAAKqL2', (SELECT body FROM payload WHERE name = 'first'));
INSERT INTO result SELECT 'missing_skipped', public.sync_imported_quiz('les_AAAAAAAAKqL9', (SELECT body FROM payload WHERE name = 'first'));
INSERT INTO result SELECT 'hub_has_no_quiz', to_jsonb(count(*)) FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAKqL2';

-- Not for signed-in people.
GRANT SELECT ON ids, payload TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d02a4", "email": "kq-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_cannot_sync', to_jsonb(pg_temp.failure($$SELECT public.sync_imported_quiz('les_AAAAAAAAKqL1', '{"source_key":"x","questions":[]}'::jsonb)$$) <> '');
-- Before the take-over an admin can't edit the imported quiz's questions.
INSERT INTO result SELECT 'imported_not_editable', to_jsonb(pg_temp.failure(format($$SELECT public.save_quiz_question(%L, %L, 'Hacked', false, '[{"label":"a","is_correct":true},{"label":"b","is_correct":false}]'::jsonb)$$, (SELECT quiz FROM ids), (SELECT q1 FROM ids))) <> '');
-- Taking the course over keeps the quiz, and then it is editable.
SELECT public.take_over_kajabi_course('crs_AAAAAAAAKqC1');
INSERT INTO result SELECT 'quiz_kept_by_takeover', to_jsonb(count(*)) FROM public.quizzes WHERE id = (SELECT quiz FROM ids);
SELECT public.save_quiz_question((SELECT quiz FROM ids), (SELECT q1 FROM ids), 'How are you after the take-over?', false, '[{"label":"Great","is_correct":false},{"label":"Fine","is_correct":true}]'::jsonb);
INSERT INTO result SELECT 'editable_after_takeover', to_jsonb(prompt) FROM public.quiz_questions WHERE id = (SELECT q1 FROM ids);
-- Bronze: an admin reads, nobody writes.
INSERT INTO result SELECT 'bronze_admin_write_refused', to_jsonb(pg_temp.failure($$INSERT INTO bronze.kajabi_quizzes (kajabi_id, course_kajabi_id, lesson_kajabi_id, raw_payload, content_hash) VALUES ('x', 'c', 'l', '{}', 'h')$$) <> '');
RESET ROLE;

-- After a take-over the lesson is the Hub's, so a later sync leaves the quiz alone.
INSERT INTO result SELECT 'sync_after_takeover', public.sync_imported_quiz('les_AAAAAAAAKqL1', (SELECT body FROM payload WHERE name = 'first'));
INSERT INTO result SELECT 'edit_survives_sync', to_jsonb(prompt) FROM public.quiz_questions WHERE id = (SELECT q1 FROM ids);
-- The taken-over lesson's quiz still carries the Kajabi key; a fresh Kajabi lesson claiming that quiz takes the key without failing.
INSERT INTO public.course_lessons (id, course_id, title, position, state, source, source_key, publishing_option) VALUES ('les_AAAAAAAAKqL6', 'crs_AAAAAAAAKqC1', 'Imported again', 2, 'open', 'kajabi', 'pgtap-kq-l6', 'published');
INSERT INTO result SELECT 'reclaimed_key', public.sync_imported_quiz('les_AAAAAAAAKqL6', (SELECT body FROM payload WHERE name = 'first'));
INSERT INTO result SELECT 'key_moved', to_jsonb((SELECT source_key FROM public.quizzes WHERE id = (SELECT quiz FROM ids)) IS NULL AND (SELECT source_key FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAKqL6') = '1573355');
INSERT INTO bronze.kajabi_quizzes (kajabi_id, course_kajabi_id, lesson_kajabi_id, raw_payload, content_hash) VALUES ('pgtap-kq-1', 'c', 'l', '{"documents": []}', 'h');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d02a4", "email": "kq-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bronze_admin_reads', to_jsonb(count(*)) FROM bronze.kajabi_quizzes WHERE kajabi_id = 'pgtap-kq-1';
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d02a1", "email": "kq-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bronze_member_reads', to_jsonb(count(*)) FROM bronze.kajabi_quizzes WHERE kajabi_id = 'pgtap-kq-1';
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'first_sync'), '{"status": "synced", "questions": 3, "options": 7, "removed_questions": 0}'::jsonb, 'the first sync creates the quiz, its three questions and seven options');
SELECT is((SELECT value FROM result WHERE label = 'quiz_row'), '"none:true:1573355"'::jsonb, 'with no passing grade, hidden answers and Kajabi''s quiz id as the key');
SELECT is((SELECT value FROM result WHERE label = 'questions'), '["How do you feel?:false", "Which are true?:false", "Pick the writing days:true"]'::jsonb, 'questions in Kajabi''s order, with whether several answers are allowed');
SELECT is((SELECT value FROM result WHERE label = 'right_answers'), '["Fine", "Both B and C", "Monday"]'::jsonb, 'with the right answers marked');
SELECT is((SELECT value FROM result WHERE label = 'second_sync'), '{"status": "synced", "questions": 3, "options": 7, "removed_questions": 0}'::jsonb, 'syncing the same payload again reports the same');
SELECT is((SELECT value FROM result WHERE label = 'same_ids'), 'true'::jsonb, 'and keeps the quiz''s and the questions'' ids');
SELECT is((SELECT value FROM result WHERE label = 'untouched'), 'true'::jsonb, 'and rewrites no quiz, question or option');
SELECT is((SELECT value FROM result WHERE label = 'counts_after_repeat'), '307'::jsonb, 'and adds no duplicates');
SELECT is((SELECT value FROM result WHERE label = 'changed_sync'), '{"status": "synced", "questions": 2, "options": 4, "removed_questions": 1}'::jsonb, 'a changed payload syncs and reports the question it removed');
SELECT is((SELECT value FROM result WHERE label = 'changed_quiz_row'), '"80:false"'::jsonb, 'the settings follow Kajabi');
SELECT is((SELECT value FROM result WHERE label = 'changed_questions'), '["Which are true?", "How do you feel today?"]'::jsonb, 'questions are updated in place and in Kajabi''s new order, the dropped one gone');
SELECT is((SELECT value FROM result WHERE label = 'changed_options'), '["A", "Both B and C, in fact", "Great", "Fine"]'::jsonb, 'options too, the dropped one gone');
SELECT is((SELECT value FROM result WHERE label = 'attempt_survives'), '11'::jsonb, 'a member''s attempt stays, with the answer to the question that stayed (the dropped one''s answer went)');
SELECT is((SELECT value FROM result WHERE label = 'hub_skipped'), '{"status": "skipped", "questions": 0, "options": 0, "removed_questions": 0}'::jsonb, 'a Hub-owned lesson is skipped');
SELECT is((SELECT value FROM result WHERE label = 'missing_skipped'), '{"status": "skipped", "questions": 0, "options": 0, "removed_questions": 0}'::jsonb, 'and so is a lesson that isn''t there');
SELECT is((SELECT value FROM result WHERE label = 'admin_cannot_sync'), 'true'::jsonb, 'a signed-in admin can''t call the sync');
SELECT ok((SELECT (value)::boolean FROM result WHERE label = 'imported_not_editable') AND (SELECT (value)::int FROM result WHERE label = 'quiz_kept_by_takeover') = 1 AND (SELECT value FROM result WHERE label = 'editable_after_takeover') = '"How are you after the take-over?"'::jsonb, 'an imported quiz can''t be edited until the course is taken over, which keeps it and makes it editable');
SELECT is((SELECT value FROM result WHERE label = 'sync_after_takeover'), '{"status": "skipped", "questions": 0, "options": 0, "removed_questions": 0}'::jsonb, 'after a take-over the import skips the quiz');
SELECT is((SELECT value FROM result WHERE label = 'edit_survives_sync'), '"How are you after the take-over?"'::jsonb, 'so an edit made after the take-over is never overwritten');
SELECT is((SELECT value FROM result WHERE label = 'reclaimed_key') ->> 'status', 'synced', 'a Kajabi lesson that claims a quiz a taken-over lesson still holds the key of is synced, not refused');
SELECT is((SELECT value FROM result WHERE label = 'key_moved'), 'true'::jsonb, 'and the key moves to it');
SELECT is((SELECT value FROM result WHERE label = 'bronze_admin_write_refused'), 'true'::jsonb, 'an admin can''t write Bronze quizzes');
SELECT is((SELECT (value)::int FROM result WHERE label = 'bronze_admin_reads') * 10 + (SELECT (value)::int FROM result WHERE label = 'bronze_member_reads'), 10, 'an admin reads Bronze quizzes and a member reads none');

SELECT finish(true);
ROLLBACK;
