-- pgTAP tests for 20271124000000_course_quizzes.sql (quizzes in courses):
--   * an admin builds the quiz of a Hub-owned lesson with their own client (audited as them, one entry per intent);
--     a quiz of an imported lesson, and anyone who isn't an admin, can't be written
--   * a question is saved whole or not at all: one correct answer for a single-answer question, at least one for
--     a multiple-answer one, two to twelve options; editing keeps option ids and removes the ones left out
--   * a member can't read questions or options (is_correct never reaches a browser), only their own attempts
--   * a member's own client can't complete a quiz lesson, a plain lesson is unchanged, the server can complete it
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(53);

-- Alice has access to the course, Bob has none, Dana is an admin.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000d01a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qz-alice@example.test'),
  ('00000000-0000-4000-a000-0000000d01a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qz-bob@example.test'),
  ('00000000-0000-4000-a000-0000000d01a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qz-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-0000000d01a1', 'qz-alice@example.test'),
  ('00000000-0000-4000-a000-0000000d01a2', 'qz-bob@example.test'),
  ('00000000-0000-4000-a000-0000000d01a4', 'qz-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-0000000d01a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAQzA1', 'Quiz Alice', 'qz-alice@example.test', now(), 'active', '00000000-0000-4000-a000-0000000d01a1'),
  ('mbr_AAAAAAAAQzA2', 'Quiz Bob', 'qz-bob@example.test', now(), 'active', '00000000-0000-4000-a000-0000000d01a2'),
  ('mbr_AAAAAAAAQzA4', 'Quiz Dana', 'qz-dana@example.test', now(), 'active', '00000000-0000-4000-a000-0000000d01a4');

INSERT INTO public.courses (id, slug, title, source, source_key) VALUES
  ('crs_AAAAAAAAQzC1', 'pgtap-quiz-hub', 'Quiz Hub Course', 'hub', NULL),
  ('crs_AAAAAAAAQzC2', 'pgtap-quiz-kajabi', 'Quiz Imported Course', 'kajabi', 'pgtap-quiz-kajabi');
INSERT INTO public.course_access (member_id, course_id, starts_at, ends_at, origin) VALUES
  ('mbr_AAAAAAAAQzA1', 'crs_AAAAAAAAQzC1', now() - interval '1 day', NULL, 'purchase');
INSERT INTO public.course_lessons (id, course_id, title, position, state, source, source_key, publishing_option) VALUES
  ('les_AAAAAAAAQzL1', 'crs_AAAAAAAAQzC1', 'Check In', 1, 'open', 'hub', NULL, 'published'),
  ('les_AAAAAAAAQzL2', 'crs_AAAAAAAAQzC1', 'Plain lesson', 2, 'open', 'hub', NULL, 'published'),
  ('les_AAAAAAAAQzL3', 'crs_AAAAAAAAQzC2', 'Imported check in', 1, 'open', 'kajabi', 'pgtap-quiz-l3', 'published'),
  ('les_AAAAAAAAQzL4', 'crs_AAAAAAAAQzC1', 'Draft quiz', 3, 'hidden', 'hub', NULL, 'draft'),
  ('les_AAAAAAAAQzL5', 'crs_AAAAAAAAQzC2', 'Imported lesson without a quiz', 2, 'open', 'kajabi', 'pgtap-quiz-l5', 'published');

-- An imported quiz, written by the service role (as the Kajabi processing run will).
INSERT INTO public.quizzes (id, lesson_id, source_key) VALUES ('quiz_AAAAAAAAQz03', 'les_AAAAAAAAQzL3', 'kajabi-quiz-1');
INSERT INTO public.quiz_questions (id, quiz_id, position, prompt, source_key) VALUES ('qques_AAAAAAAAQz31', 'quiz_AAAAAAAAQz03', 1, 'Imported question', 'kq1');
INSERT INTO public.quiz_options (id, question_id, position, label, is_correct, source_key) VALUES
  ('qopt_AAAAAAAAQz311', 'qques_AAAAAAAAQz31', 1, 'Yes', true, 'ko1'),
  ('qopt_AAAAAAAAQz312', 'qques_AAAAAAAAQz31', 2, 'No', false, 'ko2');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

CREATE FUNCTION pg_temp.refused(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation OR unique_violation THEN
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.refused(text) TO authenticated;

-- The message a statement was refused with ('' when it wasn't).
CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated;

SET LOCAL ROLE authenticated;

-- Alice (a member) can't build a quiz.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d01a1", "email": "qz-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_quiz_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.quizzes (lesson_id) VALUES ('les_AAAAAAAAQzL2')$$));
INSERT INTO result SELECT 'member_save_refused', to_jsonb(pg_temp.failure($$SELECT public.save_quiz_question('quiz_AAAAAAAAQz03', NULL, 'Hi', false, '[{"label":"a","is_correct":true},{"label":"b","is_correct":false}]'::jsonb)$$) <> '');

-- Dana (an admin) makes a quiz and builds it.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d01a4", "email": "qz-dana@example.test", "role": "authenticated"}', true);
INSERT INTO public.quizzes (lesson_id, passing_percent) VALUES ('les_AAAAAAAAQzL1', 70);
INSERT INTO public.quizzes (id, lesson_id) VALUES ('quiz_AAAAAAAAQz04', 'les_AAAAAAAAQzL4');
INSERT INTO result SELECT 'admin_quiz_id', to_jsonb(id LIKE 'quiz\_%') FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAQzL1';
INSERT INTO result SELECT 'second_quiz_for_lesson_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.quizzes (lesson_id) VALUES ('les_AAAAAAAAQzL1')$$));
INSERT INTO result SELECT 'imported_lesson_quiz_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.quizzes (lesson_id) VALUES ('les_AAAAAAAAQzL5')$$));
INSERT INTO result SELECT 'passing_percent_range', to_jsonb(pg_temp.refused($$UPDATE public.quizzes SET passing_percent = 101 WHERE lesson_id = 'les_AAAAAAAAQzL1'$$));

CREATE TEMP TABLE ids(label text, id text) ON COMMIT DROP;
GRANT ALL ON ids TO authenticated;
INSERT INTO ids SELECT 'quiz', id FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAQzL1';

-- A single-answer question, then a multiple-answer one.
INSERT INTO ids SELECT 'q1', public.save_quiz_question((SELECT id FROM ids WHERE label = 'quiz'), NULL, 'How do you feel?', false,
  '[{"label":"Great","is_correct":false},{"label":"Fine","is_correct":true},{"label":"Tired","is_correct":false}]'::jsonb);
INSERT INTO ids SELECT 'q2', public.save_quiz_question((SELECT id FROM ids WHERE label = 'quiz'), NULL, 'Pick the writing days', true,
  '[{"label":"Mon","is_correct":true},{"label":"Tue","is_correct":false},{"label":"Wed","is_correct":true}]'::jsonb);
INSERT INTO result SELECT 'question_ids', to_jsonb((SELECT id LIKE 'qques\_%' FROM ids WHERE label = 'q1') AND (SELECT count(*) = 3 AND bool_and(id LIKE 'qopt\_%') FROM public.quiz_options WHERE question_id = (SELECT id FROM ids WHERE label = 'q1')));
INSERT INTO result SELECT 'positions', to_jsonb((SELECT array_agg(position ORDER BY position) FROM public.quiz_questions WHERE quiz_id = (SELECT id FROM ids WHERE label = 'quiz')));
INSERT INTO result SELECT 'revision_after_two_saves', to_jsonb(revision) FROM public.quizzes WHERE id = (SELECT id FROM ids WHERE label = 'quiz');

-- Invalid shapes are refused, whole.
INSERT INTO result SELECT 'no_correct_refused', to_jsonb(pg_temp.failure(format($$SELECT public.save_quiz_question(%L, NULL, 'x', true, '[{"label":"a","is_correct":false},{"label":"b","is_correct":false}]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'))));
INSERT INTO result SELECT 'two_correct_single_refused', to_jsonb(pg_temp.failure(format($$SELECT public.save_quiz_question(%L, NULL, 'x', false, '[{"label":"a","is_correct":true},{"label":"b","is_correct":true}]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'))));
INSERT INTO result SELECT 'one_option_refused', to_jsonb(pg_temp.failure(format($$SELECT public.save_quiz_question(%L, NULL, 'x', false, '[{"label":"a","is_correct":true}]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'))));
INSERT INTO result SELECT 'thirteen_options_refused', to_jsonb(pg_temp.failure(format($$SELECT public.save_quiz_question(%L, NULL, 'x', false, (SELECT jsonb_agg(jsonb_build_object('label', 'o' || n, 'is_correct', n = 1)) FROM generate_series(1, 13) n))$$, (SELECT id FROM ids WHERE label = 'quiz'))));
INSERT INTO result SELECT 'blank_prompt_refused', to_jsonb(pg_temp.failure(format($$SELECT public.save_quiz_question(%L, NULL, '   ', false, '[{"label":"a","is_correct":true},{"label":"b","is_correct":false}]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'))));
INSERT INTO result SELECT 'blank_label_refused', to_jsonb(pg_temp.failure(format($$SELECT public.save_quiz_question(%L, NULL, 'x', false, '[{"label":" ","is_correct":true},{"label":"b","is_correct":false}]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'))));
INSERT INTO result SELECT 'unknown_quiz_refused', to_jsonb(pg_temp.failure($$SELECT public.save_quiz_question('quiz_NoSuchQuiz01', NULL, 'x', false, '[{"label":"a","is_correct":true},{"label":"b","is_correct":false}]'::jsonb)$$));
INSERT INTO result SELECT 'nothing_written_by_refusals', to_jsonb(count(*)) FROM public.quiz_questions WHERE quiz_id = (SELECT id FROM ids WHERE label = 'quiz');

-- Editing keeps the ids of the options that stay, drops the one left out and adds a new one.
INSERT INTO ids SELECT 'keep', id FROM public.quiz_options WHERE question_id = (SELECT id FROM ids WHERE label = 'q1') AND label = 'Fine';
SELECT public.save_quiz_question((SELECT id FROM ids WHERE label = 'quiz'), (SELECT id FROM ids WHERE label = 'q1'), 'How are you today?', false,
  jsonb_build_array(jsonb_build_object('id', (SELECT id FROM ids WHERE label = 'keep'), 'label', 'Fine, thanks', 'is_correct', true), jsonb_build_object('label', 'Wonderful', 'is_correct', false)));
INSERT INTO result SELECT 'edit_keeps_id', to_jsonb((SELECT label FROM public.quiz_options WHERE id = (SELECT id FROM ids WHERE label = 'keep')) || ':' || (SELECT position FROM public.quiz_options WHERE id = (SELECT id FROM ids WHERE label = 'keep')));
INSERT INTO result SELECT 'edit_drops_left_out', to_jsonb(array_agg(label ORDER BY position)) FROM public.quiz_options WHERE question_id = (SELECT id FROM ids WHERE label = 'q1');
INSERT INTO result SELECT 'edit_changes_prompt', to_jsonb(prompt) FROM public.quiz_questions WHERE id = (SELECT id FROM ids WHERE label = 'q1');
INSERT INTO result SELECT 'foreign_option_id_refused', to_jsonb(pg_temp.failure(format($$SELECT public.save_quiz_question(%L, %L, 'x', false, '[{"id":"qopt_AAAAAAAAQz311","label":"a","is_correct":true},{"label":"b","is_correct":false}]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'), (SELECT id FROM ids WHERE label = 'q1'))));
INSERT INTO result SELECT 'question_of_other_quiz_not_found', to_jsonb(pg_temp.failure(format($$SELECT public.save_quiz_question(%L, 'qques_AAAAAAAAQz31', 'x', false, '[{"label":"a","is_correct":true},{"label":"b","is_correct":false}]'::jsonb)$$, (SELECT id FROM ids WHERE label = 'quiz'))));

-- Reorder.
SELECT public.reorder_quiz_questions((SELECT id FROM ids WHERE label = 'quiz'), ARRAY[(SELECT id FROM ids WHERE label = 'q2'), (SELECT id FROM ids WHERE label = 'q1')]);
INSERT INTO result SELECT 'reordered', to_jsonb((SELECT array_agg(prompt ORDER BY position) FROM public.quiz_questions WHERE quiz_id = (SELECT id FROM ids WHERE label = 'quiz')));
INSERT INTO result SELECT 'stale_reorder', to_jsonb(pg_temp.failure(format($$SELECT public.reorder_quiz_questions(%L, ARRAY[%L])$$, (SELECT id FROM ids WHERE label = 'quiz'), (SELECT id FROM ids WHERE label = 'q1'))));
INSERT INTO result SELECT 'imported_reorder', to_jsonb(pg_temp.failure($$SELECT public.reorder_quiz_questions('quiz_AAAAAAAAQz03', ARRAY['qques_AAAAAAAAQz31'])$$));
INSERT INTO result SELECT 'imported_save_refused', to_jsonb(pg_temp.failure($$SELECT public.save_quiz_question('quiz_AAAAAAAAQz03', 'qques_AAAAAAAAQz31', 'Hacked', false, '[{"label":"a","is_correct":true},{"label":"b","is_correct":false}]'::jsonb)$$) <> '');
INSERT INTO result SELECT 'imported_question_text', to_jsonb(prompt) FROM public.quiz_questions WHERE id = 'qques_AAAAAAAAQz31';
-- Putting the questions in the order they are already in changes nothing.
SELECT public.reorder_quiz_questions((SELECT id FROM ids WHERE label = 'quiz'), ARRAY[(SELECT id FROM ids WHERE label = 'q2'), (SELECT id FROM ids WHERE label = 'q1')]);

-- Settings.
UPDATE public.quizzes SET passing_percent = NULL, hide_answers = true WHERE id = (SELECT id FROM ids WHERE label = 'quiz');
INSERT INTO result SELECT 'settings', to_jsonb(coalesce(passing_percent::text, 'none') || ':' || hide_answers) FROM public.quizzes WHERE id = (SELECT id FROM ids WHERE label = 'quiz');

-- Delete a question: the next ones close up.
SELECT public.delete_quiz_question((SELECT id FROM ids WHERE label = 'quiz'), (SELECT id FROM ids WHERE label = 'q2'));
INSERT INTO result SELECT 'after_delete', to_jsonb((SELECT array_agg(position) FROM public.quiz_questions WHERE quiz_id = (SELECT id FROM ids WHERE label = 'quiz')));
INSERT INTO result SELECT 'delete_missing', to_jsonb(pg_temp.failure(format($$SELECT public.delete_quiz_question(%L, 'qques_NoSuchQuestion')$$, (SELECT id FROM ids WHERE label = 'quiz'))));
INSERT INTO result SELECT 'options_go_with_question', to_jsonb(count(*)) FROM public.quiz_options WHERE question_id = (SELECT id FROM ids WHERE label = 'q2');
RESET ROLE;

-- Attempts are written by the server (the service role, here the owner), after scoring.
INSERT INTO public.quiz_attempts (id, quiz_id, member_id, question_count, correct_count, score_percent, passed)
  VALUES ('qatt_AAAAAAAAQz01', (SELECT id FROM ids WHERE label = 'quiz'), 'mbr_AAAAAAAAQzA1', 1, 1, 100, true),
         ('qatt_AAAAAAAAQz02', (SELECT id FROM ids WHERE label = 'quiz'), 'mbr_AAAAAAAAQzA2', 1, 0, 0, false);
INSERT INTO public.quiz_attempt_answers (attempt_id, question_id, selected_option_ids, is_correct)
  VALUES ('qatt_AAAAAAAAQz01', (SELECT id FROM ids WHERE label = 'q1'), ARRAY[(SELECT id FROM ids WHERE label = 'keep')], true),
         ('qatt_AAAAAAAAQz02', (SELECT id FROM ids WHERE label = 'q1'), '{}', false);

SET LOCAL ROLE authenticated;
-- Alice: sees the settings of the open lesson's quiz and her own attempt, never questions, options or Bob's attempt.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d01a1", "email": "qz-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_sees_quiz_settings', to_jsonb(count(*)) FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAQzL1';
INSERT INTO result SELECT 'alice_no_draft_quiz', to_jsonb(count(*)) FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAQzL4';
INSERT INTO result SELECT 'alice_questions', to_jsonb(count(*)) FROM public.quiz_questions;
INSERT INTO result SELECT 'alice_options', to_jsonb(count(*)) FROM public.quiz_options;
INSERT INTO result SELECT 'alice_attempts', to_jsonb(array_agg(id)) FROM public.quiz_attempts;
INSERT INTO result SELECT 'alice_answers', to_jsonb(count(*)) FROM public.quiz_attempt_answers;
INSERT INTO result SELECT 'alice_attempt_insert_refused', to_jsonb(pg_temp.refused(format($$INSERT INTO public.quiz_attempts (quiz_id, member_id, question_count, correct_count, score_percent, passed) VALUES (%L, 'mbr_AAAAAAAAQzA1', 1, 1, 100, true)$$, (SELECT id FROM ids WHERE label = 'quiz'))));
INSERT INTO result SELECT 'alice_attempt_edit_refused', to_jsonb(pg_temp.refused($$UPDATE public.quiz_attempts SET passed = true, score_percent = 100 WHERE id = 'qatt_AAAAAAAAQz01'$$));
-- She can't complete the quiz lesson herself, but can complete a plain one and clear her own mark.
INSERT INTO result SELECT 'alice_complete_quiz_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.lesson_progress (member_id, lesson_id, completed_at) VALUES ('mbr_AAAAAAAAQzA1', 'les_AAAAAAAAQzL1', now())$$));
INSERT INTO public.lesson_progress (member_id, lesson_id, completed_at) VALUES ('mbr_AAAAAAAAQzA1', 'les_AAAAAAAAQzL2', now());
INSERT INTO result SELECT 'alice_complete_plain_lesson', to_jsonb(count(*)) FROM public.lesson_progress WHERE member_id = 'mbr_AAAAAAAAQzA1' AND lesson_id = 'les_AAAAAAAAQzL2' AND completed_at IS NOT NULL;
-- Position saved without completing a quiz lesson is fine.
INSERT INTO public.lesson_progress (member_id, lesson_id, last_position_seconds) VALUES ('mbr_AAAAAAAAQzA1', 'les_AAAAAAAAQzL1', 12);
INSERT INTO result SELECT 'alice_position_on_quiz_lesson', to_jsonb(count(*)) FROM public.lesson_progress WHERE lesson_id = 'les_AAAAAAAAQzL1';
INSERT INTO result SELECT 'alice_update_complete_refused', to_jsonb(pg_temp.refused($$UPDATE public.lesson_progress SET completed_at = now() WHERE member_id = 'mbr_AAAAAAAAQzA1' AND lesson_id = 'les_AAAAAAAAQzL1'$$));

-- Bob (no access): no questions, no options, no attempt but his own.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d01a2", "email": "qz-bob@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bob_quiz_settings', to_jsonb(count(*)) FROM public.quizzes;
INSERT INTO result SELECT 'bob_attempts', to_jsonb(array_agg(id)) FROM public.quiz_attempts;

-- Dana sees everyone's attempts and answers.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d01a4", "email": "qz-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'dana_attempts', to_jsonb(count(*)) FROM public.quiz_attempts WHERE id IN ('qatt_AAAAAAAAQz01', 'qatt_AAAAAAAAQz02');
INSERT INTO result SELECT 'dana_answers', to_jsonb(count(*)) FROM public.quiz_attempt_answers;
INSERT INTO result SELECT 'dana_options', to_jsonb(count(*) > 0) FROM public.quiz_options;
RESET ROLE;

-- The server (no user client) completes the quiz lesson after scoring.
UPDATE public.lesson_progress SET completed_at = now() WHERE member_id = 'mbr_AAAAAAAAQzA1' AND lesson_id = 'les_AAAAAAAAQzL1';
INSERT INTO result SELECT 'server_completes_quiz_lesson', to_jsonb(count(*)) FROM public.lesson_progress WHERE lesson_id = 'les_AAAAAAAAQzL1' AND completed_at IS NOT NULL;

-- Deleting a lesson takes its quiz, questions, options and attempts with it.
DELETE FROM public.course_lessons WHERE id = 'les_AAAAAAAAQzL1';
INSERT INTO result SELECT 'cascade', to_jsonb((SELECT count(*) FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAQzL1') + (SELECT count(*) FROM public.quiz_questions WHERE id = (SELECT id FROM ids WHERE label = 'q1')) + (SELECT count(*) FROM public.quiz_attempts WHERE id IN ('qatt_AAAAAAAAQz01', 'qatt_AAAAAAAAQz02')) + (SELECT count(*) FROM public.quiz_attempt_answers WHERE attempt_id IN ('qatt_AAAAAAAAQz01', 'qatt_AAAAAAAAQz02')));

SELECT is((SELECT value FROM result WHERE label = 'member_quiz_refused'), 'true'::jsonb, 'a member can''t make a quiz');
SELECT is((SELECT value FROM result WHERE label = 'member_save_refused'), 'true'::jsonb, 'a member can''t save a question');
SELECT is((SELECT value FROM result WHERE label = 'admin_quiz_id'), 'true'::jsonb, 'a new quiz gets a short quiz_ id');
SELECT is((SELECT value FROM result WHERE label = 'second_quiz_for_lesson_refused'), 'true'::jsonb, 'a lesson has one quiz at most');
SELECT is((SELECT value FROM result WHERE label = 'imported_lesson_quiz_refused'), 'true'::jsonb, 'an admin can''t make a quiz of an imported lesson');
SELECT is((SELECT count(*)::int FROM public.quizzes WHERE lesson_id = 'les_AAAAAAAAQzL5'), 0, 'and none was made');
SELECT is((SELECT value FROM result WHERE label = 'passing_percent_range'), 'true'::jsonb, 'a passing grade is 1 to 100');
SELECT is((SELECT value FROM result WHERE label = 'question_ids'), 'true'::jsonb, 'questions and options get short prefixed ids');
SELECT is((SELECT value FROM result WHERE label = 'positions'), '[1, 2]'::jsonb, 'questions are added at the end');
SELECT is((SELECT value FROM result WHERE label = 'revision_after_two_saves'), '2'::jsonb, 'each saved question bumps the quiz''s revision');
SELECT is((SELECT value FROM result WHERE label = 'no_correct_refused'), '"invalid_question"'::jsonb, 'a question needs a correct answer');
SELECT is((SELECT value FROM result WHERE label = 'two_correct_single_refused'), '"invalid_question"'::jsonb, 'a single-answer question has exactly one correct answer');
SELECT is((SELECT value FROM result WHERE label = 'one_option_refused'), '"invalid_question"'::jsonb, 'a question needs at least two options');
SELECT is((SELECT value FROM result WHERE label = 'thirteen_options_refused'), '"invalid_question"'::jsonb, 'a question has twelve options at most');
SELECT is((SELECT value FROM result WHERE label = 'blank_prompt_refused'), '"invalid_question"'::jsonb, 'a question needs text');
SELECT is((SELECT value FROM result WHERE label = 'blank_label_refused'), '"invalid_question"'::jsonb, 'an option needs text');
SELECT is((SELECT value FROM result WHERE label = 'unknown_quiz_refused'), '"not_found"'::jsonb, 'an unknown quiz is not found');
SELECT is((SELECT value FROM result WHERE label = 'nothing_written_by_refusals'), '2'::jsonb, 'a refused question leaves nothing behind');
SELECT is((SELECT value FROM result WHERE label = 'edit_keeps_id'), '"Fine, thanks:1"'::jsonb, 'editing keeps an option''s id and puts it where it was listed');
SELECT is((SELECT value FROM result WHERE label = 'edit_drops_left_out'), '["Fine, thanks", "Wonderful"]'::jsonb, 'editing removes the options left out and adds the new one');
SELECT is((SELECT value FROM result WHERE label = 'edit_changes_prompt'), '"How are you today?"'::jsonb, 'editing changes the prompt');
SELECT is((SELECT value FROM result WHERE label = 'foreign_option_id_refused'), '"invalid_question"'::jsonb, 'an option id of another question is refused');
SELECT is((SELECT value FROM result WHERE label = 'question_of_other_quiz_not_found'), '"not_found"'::jsonb, 'a question of another quiz is not found');
SELECT is((SELECT value FROM result WHERE label = 'reordered'), '["Pick the writing days", "How are you today?"]'::jsonb, 'an admin reorders the questions');
SELECT is((SELECT value FROM result WHERE label = 'stale_reorder'), '"stale_order"'::jsonb, 'a partial list is a stale order');
SELECT is((SELECT value FROM result WHERE label = 'imported_save_refused'), 'true'::jsonb, 'an admin can''t edit an imported quiz''s questions');
SELECT is((SELECT value FROM result WHERE label = 'imported_question_text'), '"Imported question"'::jsonb, 'an imported question is unchanged');
SELECT is((SELECT value FROM result WHERE label = 'imported_reorder'), '""'::jsonb, 'reordering one question into the order it has is a no-op, even for an imported quiz');
SELECT is((SELECT value FROM result WHERE label = 'settings'), '"none:true"'::jsonb, 'an admin sets no passing grade and hides answers');
SELECT is((SELECT value FROM result WHERE label = 'after_delete'), '[1]'::jsonb, 'deleting a question closes the gap');
SELECT is((SELECT value FROM result WHERE label = 'delete_missing'), '"not_found"'::jsonb, 'deleting a missing question is not found');
SELECT is((SELECT value FROM result WHERE label = 'options_go_with_question'), '0'::jsonb, 'a deleted question''s options go with it');
SELECT is((SELECT value FROM result WHERE label = 'alice_sees_quiz_settings'), '1'::jsonb, 'a member reads the settings of a quiz in a lesson they can read');
SELECT is((SELECT value FROM result WHERE label = 'alice_no_draft_quiz'), '0'::jsonb, 'but not a draft lesson''s quiz');
SELECT is((SELECT (value)::int FROM result WHERE label = 'alice_questions') + (SELECT (value)::int FROM result WHERE label = 'alice_options'), 0, 'a member reads no questions or options (is_correct never reaches a browser)');
SELECT is((SELECT value FROM result WHERE label = 'alice_attempts'), '["qatt_AAAAAAAAQz01"]'::jsonb, 'a member reads only their own attempts');
SELECT is((SELECT value FROM result WHERE label = 'alice_answers'), '1'::jsonb, 'and only the answers in them');
SELECT ok((SELECT (value)::boolean FROM result WHERE label = 'alice_attempt_insert_refused') AND (SELECT (value)::boolean FROM result WHERE label = 'alice_attempt_edit_refused'), 'a member can''t write or change an attempt');
SELECT ok((SELECT (value)::boolean FROM result WHERE label = 'alice_complete_quiz_refused') AND (SELECT (value)::boolean FROM result WHERE label = 'alice_update_complete_refused'), 'a member can''t complete a quiz lesson with their own client');
SELECT is((SELECT value FROM result WHERE label = 'alice_complete_plain_lesson'), '1'::jsonb, 'a plain lesson is still completed by the member');
SELECT is((SELECT value FROM result WHERE label = 'alice_position_on_quiz_lesson'), '1'::jsonb, 'a quiz lesson can still be opened (progress without completion)');
SELECT is((SELECT value FROM result WHERE label = 'bob_quiz_settings'), '0'::jsonb, 'a member without access reads no quiz');
SELECT is((SELECT value FROM result WHERE label = 'bob_attempts'), '["qatt_AAAAAAAAQz02"]'::jsonb, 'a member without access sees only their own attempt');
SELECT is((SELECT (value)::int FROM result WHERE label = 'dana_attempts') * 100 + (SELECT (value)::int FROM result WHERE label = 'dana_answers'), 202, 'an admin reads every attempt and answer');
SELECT is((SELECT value FROM result WHERE label = 'dana_options'), 'true'::jsonb, 'an admin reads the options');
SELECT is((SELECT value FROM result WHERE label = 'server_completes_quiz_lesson'), '1'::jsonb, 'the server completes a quiz lesson after scoring');
SELECT is((SELECT value FROM result WHERE label = 'cascade'), '0'::jsonb, 'deleting the lesson removes its quiz, questions, attempts and answers');

-- Audit: the quiz is one entry as the admin; questions and options write none (the revision on the quiz says so);
-- the service role's writes (the imported quiz) write none.
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'quiz' AND action = 'insert' AND entity_id = (SELECT id FROM ids WHERE label = 'quiz') AND entity_label = 'Check In' AND changed_by = '00000000-0000-4000-a000-0000000d01a4' AND actor_kind = 'staff'), 1, 'making a quiz is one entry, as the admin, named by its lesson');
SELECT ok(EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'quiz' AND entity_id = (SELECT id FROM ids WHERE label = 'quiz') AND changes ? 'revision'), 'editing the questions and the settings is recorded on the quiz');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type IN ('quiz_question', 'quiz_option')), 0, 'questions and options write no entry of their own');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'quiz' AND entity_id = 'quiz_AAAAAAAAQz03'), 0, 'the service role''s writes (the imported quiz) are not audited');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'quiz' AND changes::text ILIKE '%writing days%'), 0, 'question text is never in the log');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'quiz' AND action = 'delete' AND entity_id = (SELECT id FROM ids WHERE label = 'quiz')), 1, 'deleting the lesson (and so the quiz) is recorded');

SELECT finish(true);
ROLLBACK;
