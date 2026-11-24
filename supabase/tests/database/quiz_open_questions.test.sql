-- pgTAP tests for 20271125100001_quiz_open_questions.sql (quiz questions that are not graded):
--   * short answer, file upload and ungraded choice questions are saved by the same function as choice questions, with
--     the shapes they can and can't have; the kind of a question that exists can't change; the old five-argument
--     function still saves a graded choice question
--   * the table keeps the rules too: an open question is never graded, a file answer is whole and at most 10 MB
--   * what a member wrote or uploaded is readable by that member and by admins, and nobody else
--   * the files live in a private bucket with no policy and a 10 MB limit
--   * a removal request deletes a member's quiz attempts (their words and files are theirs)
--   * the Kajabi Silver step stores the kind and keeps an open question without options
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(30);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000d02a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qo-alice@example.test'),
  ('00000000-0000-4000-a000-0000000d02a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qo-bob@example.test'),
  ('00000000-0000-4000-a000-0000000d02a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qo-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-0000000d02a1', 'qo-alice@example.test'),
  ('00000000-0000-4000-a000-0000000d02a2', 'qo-bob@example.test'),
  ('00000000-0000-4000-a000-0000000d02a4', 'qo-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-a000-0000000d02a4', 'admin') ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAQoA1', 'Open Alice', 'qo-alice@example.test', now(), 'active', '00000000-0000-4000-a000-0000000d02a1'),
  ('mbr_AAAAAAAAQoA2', 'Open Bob', 'qo-bob@example.test', now(), 'active', '00000000-0000-4000-a000-0000000d02a2'),
  ('mbr_AAAAAAAAQoA4', 'Open Dana', 'qo-dana@example.test', now(), 'active', '00000000-0000-4000-a000-0000000d02a4');
INSERT INTO public.courses (id, slug, title, source, source_key) VALUES
  ('crs_AAAAAAAAQoC1', 'pgtap-open-hub', 'Open Hub Course', 'hub', NULL),
  ('crs_AAAAAAAAQoC2', 'pgtap-open-kajabi', 'Open Imported Course', 'kajabi', 'pgtap-open-kajabi');
INSERT INTO public.course_lessons (id, course_id, title, position, state, source, source_key, publishing_option) VALUES
  ('les_AAAAAAAAQoL1', 'crs_AAAAAAAAQoC1', 'Reflect', 1, 'open', 'hub', NULL, 'published'),
  ('les_AAAAAAAAQoL2', 'crs_AAAAAAAAQoC2', 'Imported reflect', 1, 'open', 'kajabi', 'pgtap-open-l2', 'published');

CREATE TEMP TABLE ids(label text, id text) ON COMMIT DROP;
GRANT ALL ON ids TO authenticated;

CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated;

-- Dana builds the quiz as herself.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d02a4", "email": "qo-dana@example.test", "role": "authenticated"}', true);
INSERT INTO public.quizzes (lesson_id) VALUES ('les_AAAAAAAAQoL1');
INSERT INTO ids SELECT 'quiz', id FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAQoL1';

INSERT INTO ids SELECT 'text', public.save_quiz_question_of_kind((SELECT id FROM ids WHERE label = 'quiz'), NULL, 'What stood out?', 'short_answer', false, false, '[]'::jsonb);
INSERT INTO ids SELECT 'file', public.save_quiz_question_of_kind((SELECT id FROM ids WHERE label = 'quiz'), NULL, 'Upload your letter', 'file_upload', false, false, NULL);
INSERT INTO ids SELECT 'choice', public.save_quiz_question_of_kind((SELECT id FROM ids WHERE label = 'quiz'), NULL, 'How was it?', 'choice', false, false,
  '[{"label":"Easy","is_correct":true},{"label":"Hard","is_correct":false}]'::jsonb);
INSERT INTO ids SELECT 'old', public.save_quiz_question((SELECT id FROM ids WHERE label = 'quiz'), NULL, 'Two plus two?', false,
  '[{"label":"4","is_correct":true},{"label":"5","is_correct":false}]'::jsonb);

SELECT is((SELECT array_agg(kind || ':' || graded ORDER BY position) FROM public.quiz_questions WHERE quiz_id = (SELECT id FROM ids WHERE label = 'quiz')),
  ARRAY['short_answer:false', 'file_upload:false', 'choice:false', 'choice:true'], 'the kinds and grading are stored in order; the five-argument function saves a graded choice question');
SELECT is((SELECT count(*)::int FROM public.quiz_options WHERE question_id IN (SELECT id FROM ids WHERE label IN ('text', 'file'))), 0, 'a short answer and a file upload have no options');
SELECT is((SELECT count(*)::int FROM public.quiz_options WHERE question_id = (SELECT id FROM ids WHERE label = 'choice') AND is_correct), 0, 'an ungraded choice question keeps no right answer, whatever was marked');
SELECT is((SELECT revision FROM public.quizzes WHERE id = (SELECT id FROM ids WHERE label = 'quiz')), 4, 'each save is one revision of the quiz (the audit entry)');

SELECT isnt(pg_temp.failure(format($$SELECT public.save_quiz_question_of_kind(%L, NULL, 'x', 'short_answer', true, false, '[]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'))), '', 'a short answer can''t be graded');
SELECT isnt(pg_temp.failure(format($$SELECT public.save_quiz_question_of_kind(%L, NULL, 'x', 'file_upload', false, false, '[{"label":"a","is_correct":false},{"label":"b","is_correct":false}]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'))), '', 'a file upload can''t have options');
SELECT isnt(pg_temp.failure(format($$SELECT public.save_quiz_question_of_kind(%L, NULL, 'x', 'essay', false, false, '[]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'))), '', 'an unknown kind is refused');
SELECT isnt(pg_temp.failure(format($$SELECT public.save_quiz_question_of_kind(%L, NULL, 'x', 'choice', true, false, '[{"label":"a","is_correct":false},{"label":"b","is_correct":false}]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'))), '', 'a graded choice question still needs a right answer');
SELECT is(pg_temp.failure(format($$SELECT public.save_quiz_question_of_kind(%L, %L, 'x', 'file_upload', false, false, '[]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'), (SELECT id FROM ids WHERE label = 'text'))), 'invalid_question', 'the kind of a question that exists can''t change');
SELECT is(pg_temp.failure($$SELECT public.save_quiz_question_of_kind('quiz_NoSuchQuiz01', NULL, 'x', 'short_answer', false, false, '[]'::jsonb)$$), 'not_found', 'a quiz that isn''t there is not found');

-- Grading a choice question on again needs its right answer; the ids of the options that stay are kept.
INSERT INTO ids SELECT 'easy', id FROM public.quiz_options WHERE question_id = (SELECT id FROM ids WHERE label = 'choice') AND label = 'Easy';
SELECT public.save_quiz_question_of_kind((SELECT id FROM ids WHERE label = 'quiz'), (SELECT id FROM ids WHERE label = 'choice'), 'How was it?', 'choice', true, false,
  jsonb_build_array(jsonb_build_object('id', (SELECT id FROM ids WHERE label = 'easy'), 'label', 'Easy', 'is_correct', true), jsonb_build_object('label', 'Hard', 'is_correct', false)));
SELECT is((SELECT graded FROM public.quiz_questions WHERE id = (SELECT id FROM ids WHERE label = 'choice')), true, 'grading can be turned on again');
SELECT is((SELECT is_correct FROM public.quiz_options WHERE id = (SELECT id FROM ids WHERE label = 'easy')), true, 'and the option keeps its id and its mark');

-- The service role writes an imported quiz (the Kajabi Silver step).
RESET ROLE;
SELECT is(
  (public.sync_imported_quiz('les_AAAAAAAAQoL2', '{"source_key":"489121","passing_percent":null,"hide_answers":false,"questions":[
    {"source_key":"s1","prompt":"Tell us more","kind":"short_answer","graded":true,"options":[{"source_key":"x","label":"ignored","is_correct":true}]},
    {"source_key":"f1","prompt":"Upload","kind":"file_upload"},
    {"source_key":"c1","prompt":"How was it?","kind":"choice","graded":false,"options":[{"source_key":"c1a","label":"Easy","is_correct":true},{"source_key":"c1b","label":"Hard","is_correct":false}]},
    {"source_key":"c2","prompt":"Two plus two?","options":[{"source_key":"c2a","label":"4","is_correct":true},{"source_key":"c2b","label":"5","is_correct":false}]}]}'::jsonb)) ->> 'status',
  'synced', 'the Silver step imports a quiz with open questions');
SELECT is((SELECT array_agg(kind || ':' || graded ORDER BY position) FROM public.quiz_questions WHERE quiz_id = (SELECT id FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAQoL2')),
  ARRAY['short_answer:false', 'file_upload:false', 'choice:false', 'choice:true'], 'a short answer is never graded, an ungraded choice question stays so, a question with no kind is a graded choice question');
SELECT is((SELECT count(*)::int FROM public.quiz_options o JOIN public.quiz_questions q ON q.id = o.question_id WHERE q.source_key IN ('s1', 'f1', 'c1') AND o.is_correct), 0, 'no option of an open or ungraded question is right, and an open question has none');
SELECT is((SELECT (public.sync_imported_quiz('les_AAAAAAAAQoL2', (SELECT jsonb_build_object('source_key', '489121', 'hide_answers', false, 'questions', '[{"source_key":"s1","prompt":"Tell us more","kind":"short_answer"}]'::jsonb)))) ->> 'removed_questions'), '3', 'a question Kajabi dropped is removed');

-- Table rules.
SELECT is(pg_temp.failure($$INSERT INTO public.quiz_questions (quiz_id, prompt, kind, graded) VALUES ((SELECT id FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAQoL2'), 'x', 'short_answer', true)$$) LIKE '%quiz_questions_open_not_graded%', true, 'the table refuses a graded short answer');
SELECT is(pg_temp.failure($$INSERT INTO public.quiz_questions (quiz_id, prompt, kind) VALUES ((SELECT id FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAQoL2'), 'x', 'essay')$$) LIKE '%quiz_questions_kind_check%', true, 'and a kind it doesn''t know');

-- Alice answers with words and a file; Bob answers too.
INSERT INTO public.quiz_attempts (id, quiz_id, member_id, question_count, correct_count, score_percent, passed) VALUES
  ('qatt_AAAAAAAAQo01', (SELECT id FROM ids WHERE label = 'quiz'), 'mbr_AAAAAAAAQoA1', 0, 0, 0, true),
  ('qatt_AAAAAAAAQo02', (SELECT id FROM ids WHERE label = 'quiz'), 'mbr_AAAAAAAAQoA2', 0, 0, 0, true);
INSERT INTO public.quiz_attempt_answers (attempt_id, question_id, answer_text) VALUES
  ('qatt_AAAAAAAAQo01', (SELECT id FROM ids WHERE label = 'text'), 'Alice''s own words'),
  ('qatt_AAAAAAAAQo02', (SELECT id FROM ids WHERE label = 'text'), 'Bob''s own words');
INSERT INTO public.quiz_attempt_answers (attempt_id, question_id, file_path, file_name, file_bytes) VALUES
  ('qatt_AAAAAAAAQo01', (SELECT id FROM ids WHERE label = 'file'), 'mbr_AAAAAAAAQoA1/11111111-1111-4111-8111-111111111111/letter.pdf', 'letter.pdf', 2048);

SELECT is(pg_temp.failure($$INSERT INTO public.quiz_attempt_answers (attempt_id, question_id, file_path) VALUES ('qatt_AAAAAAAAQo02', (SELECT id FROM ids WHERE label = 'file'), 'p')$$) LIKE '%quiz_attempt_answers_file_whole%', true, 'a file answer needs its name and size too');
SELECT is(pg_temp.failure($$INSERT INTO public.quiz_attempt_answers (attempt_id, question_id, file_path, file_name, file_bytes) VALUES ('qatt_AAAAAAAAQo02', (SELECT id FROM ids WHERE label = 'file'), 'p', 'n', 10485761)$$) LIKE '%quiz_attempt_answers_file_whole%', true, 'and is at most 10 MB');
SELECT is(pg_temp.failure($$INSERT INTO public.quiz_attempt_answers (attempt_id, question_id, answer_text) VALUES ('qatt_AAAAAAAAQo02', (SELECT id FROM ids WHERE label = 'file'), repeat('x', 20001))$$) LIKE '%quiz_attempt_answers_text_length%', true, 'a typed answer is at most 20,000 characters');

-- Who reads what.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d02a1", "email": "qo-alice@example.test", "role": "authenticated"}', true);
SELECT is((SELECT array_agg(answer_text) FROM public.quiz_attempt_answers WHERE answer_text IS NOT NULL), ARRAY['Alice''s own words'], 'a member reads their own words, and only theirs');
SELECT is((SELECT count(*)::int FROM public.quiz_attempt_answers WHERE file_path IS NOT NULL), 1, 'and their own file');
SELECT isnt(pg_temp.failure($$UPDATE public.quiz_attempt_answers SET answer_text = 'edited' WHERE attempt_id = 'qatt_AAAAAAAAQo01'$$), '', 'a member can''t rewrite what was recorded');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d02a4", "email": "qo-dana@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.quiz_attempt_answers WHERE answer_text IS NOT NULL), 2, 'an admin reads every member''s words');
RESET ROLE;

-- The files: a private bucket, 10 MB, no policy that names it.
SELECT is((SELECT public FROM storage.buckets WHERE id = 'quiz-answer-files'), false, 'the answer files bucket is private');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'quiz-answer-files'), 10485760::bigint, 'and limited to 10 MB');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%''quiz-answer-files''%'), 0, 'with no policy: only the server reaches it');

-- Removal on request.
SELECT is((SELECT action FROM public.member_data_handling WHERE table_name = 'quiz_attempts' AND column_name = 'member_id'), 'delete', 'a removal request deletes a member''s quiz attempts, with their words and files');

SELECT * FROM finish(true);
ROLLBACK;
