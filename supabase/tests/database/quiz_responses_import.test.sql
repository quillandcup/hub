-- pgTAP tests for 20271126100002_quiz_responses_import.sql (past quiz responses imported from Kajabi):
--   * bronze.kajabi_quiz_responses holds members' own writing: admins read it, members and anonymous callers don't
--   * import_quiz_attempt() inserts one submission whole (attempt and answers, unscored, marked from Kajabi) and does nothing the
--     second time; an attempt made in the Hub, which has no key, is never touched and never collides
--   * the attempt's key and its mark go together; only the service role runs the function
--   * an imported answer is readable by the member it belongs to and by admins, and by nobody else
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(22);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000d03a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qr-alice@example.test'),
  ('00000000-0000-4000-a000-0000000d03a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qr-bob@example.test'),
  ('00000000-0000-4000-a000-0000000d03a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qr-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-0000000d03a1', 'qr-alice@example.test'),
  ('00000000-0000-4000-a000-0000000d03a2', 'qr-bob@example.test'),
  ('00000000-0000-4000-a000-0000000d03a4', 'qr-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-a000-0000000d03a4', 'admin') ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAQrA1', 'Resp Alice', 'qr-alice@example.test', now(), 'active', '00000000-0000-4000-a000-0000000d03a1'),
  ('mbr_AAAAAAAAQrA2', 'Resp Bob', 'qr-bob@example.test', now(), 'active', '00000000-0000-4000-a000-0000000d03a2'),
  ('mbr_AAAAAAAAQrA4', 'Resp Dana', 'qr-dana@example.test', now(), 'active', '00000000-0000-4000-a000-0000000d03a4');
INSERT INTO public.courses (id, slug, title, source, source_key) VALUES ('crs_AAAAAAAAQrC1', 'pgtap-resp-kajabi', 'Resp Course', 'kajabi', 'pgtap-resp-kajabi');
INSERT INTO public.course_lessons (id, course_id, title, position, state, source, source_key, publishing_option) VALUES
  ('les_AAAAAAAAQrL1', 'crs_AAAAAAAAQrC1', 'Reflect', 1, 'open', 'kajabi', 'pgtap-resp-l1', 'published');
INSERT INTO public.quizzes (id, lesson_id, source_key) VALUES ('quiz_AAAAAAAAQr01', 'les_AAAAAAAAQrL1', 'pgtap-489121');
INSERT INTO public.quiz_questions (id, quiz_id, position, prompt, kind, graded, source_key) VALUES
  ('qques_AAAAAAAAQr11', 'quiz_AAAAAAAAQr01', 1, 'What stood out?', 'short_answer', false, 's1'),
  ('qques_AAAAAAAAQr12', 'quiz_AAAAAAAAQr01', 2, 'Upload', 'file_upload', false, 'f1');

CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated, anon;

-- Bronze: written by the service role (this session), read by admins only.
INSERT INTO bronze.kajabi_quiz_responses (quiz_kajabi_id, submission_key, course_kajabi_id, email, submitted_at, answers, content_hash) VALUES
  ('pgtap-489121', 's-1', 'pgtap-resp-kajabi', 'someone@example.test', '2026-03-04T15:30:00Z', '[{"question_key":"s1","text":"words"}]', 'h1');
SELECT is((SELECT count(*)::int FROM bronze.kajabi_quiz_responses WHERE quiz_kajabi_id = 'pgtap-489121'), 1, 'the service role writes Bronze');
SELECT isnt(pg_temp.failure($$INSERT INTO bronze.kajabi_quiz_responses (quiz_kajabi_id, submission_key, course_kajabi_id, email, answers, content_hash) VALUES ('pgtap-489121', 's-1', 'c', 'x@example.test', '[]', 'h')$$), '', 'a submission key is unique within its quiz');

-- The Silver step, as the service role.
SELECT is(public.import_quiz_attempt('{"quiz_id":"quiz_AAAAAAAAQr01","member_id":"mbr_AAAAAAAAQrA1","source_key":"s-1","submitted_at":"2026-03-04T15:30:00Z","answers":[
  {"question_id":"qques_AAAAAAAAQr11","answer_text":"Alice''s own words","prompt_snapshot":"What stood out? (then)"},
  {"question_id":"qques_AAAAAAAAQr12","file_path":"mbr_AAAAAAAAQrA1/11111111-1111-4111-8111-111111111111/letter.pdf","file_name":"letter.pdf","file_bytes":2048}]}'::jsonb), 'inserted', 'a submission is inserted');
SELECT is((SELECT row(question_count, correct_count, score_percent, passed, imported_from, source_key, submitted_at)::text FROM public.quiz_attempts WHERE quiz_id = 'quiz_AAAAAAAAQr01'),
  '(0,0,0,t,kajabi,s-1,"2026-03-04 15:30:00+00")', 'the attempt is not scored, counts as passed, says it is from Kajabi and keeps its date');
SELECT is((SELECT count(*)::int FROM public.quiz_attempt_answers WHERE attempt_id = (SELECT id FROM public.quiz_attempts WHERE source_key = 's-1')), 2, 'with both of its answers');
SELECT is((SELECT prompt_snapshot FROM public.quiz_attempt_answers WHERE answer_text IS NOT NULL AND attempt_id = (SELECT id FROM public.quiz_attempts WHERE source_key = 's-1')), 'What stood out? (then)', 'the question as it was worded then is kept');
SELECT is(public.import_quiz_attempt('{"quiz_id":"quiz_AAAAAAAAQr01","member_id":"mbr_AAAAAAAAQrA2","source_key":"s-1","answers":[{"question_id":"qques_AAAAAAAAQr11","answer_text":"other"}]}'::jsonb), 'exists', 'the same submission again does nothing, whoever it is for');
SELECT is((SELECT count(*)::int FROM public.quiz_attempts WHERE quiz_id = 'quiz_AAAAAAAAQr01'), 1, 'so there is still one attempt');
SELECT is((SELECT answer_text FROM public.quiz_attempt_answers WHERE answer_text IS NOT NULL AND attempt_id = (SELECT id FROM public.quiz_attempts WHERE source_key = 's-1')), 'Alice''s own words', 'and its answers are unchanged');

-- Answers no question could be matched to are kept on the attempt, whole.
SELECT is(public.import_quiz_attempt('{"quiz_id":"quiz_AAAAAAAAQr01","member_id":"mbr_AAAAAAAAQrA1","source_key":"s-2","answers":[],"unlinked":[{"position":3,"prompt":"As it was asked","kind":"short_answer","text":"Kept words","labels":[],"file":null}]}'::jsonb), 'inserted', 'an import with answers that match no question is inserted');
SELECT is((SELECT unlinked_answers -> 0 ->> 'text' FROM public.quiz_attempts WHERE source_key = 's-2'), 'Kept words', 'and keeps them with their own wording on the attempt');
SELECT is((SELECT unlinked_answers IS NULL FROM public.quiz_attempts WHERE source_key = 's-1'), true, 'an attempt with none has none');
SELECT isnt(pg_temp.failure($$UPDATE public.quiz_attempts SET unlinked_answers = '{"not":"a list"}'::jsonb WHERE source_key = 's-2'$$), '', 'what is kept there is a list');

-- A Hub attempt has no key, and several can exist beside an import.
INSERT INTO public.quiz_attempts (id, quiz_id, member_id, question_count, correct_count, score_percent, passed) VALUES
  ('qatt_AAAAAAAAQr01', 'quiz_AAAAAAAAQr01', 'mbr_AAAAAAAAQrA2', 0, 0, 0, true),
  ('qatt_AAAAAAAAQr02', 'quiz_AAAAAAAAQr01', 'mbr_AAAAAAAAQrA2', 0, 0, 0, true);
SELECT is((SELECT count(*)::int FROM public.quiz_attempts WHERE source_key IS NULL AND imported_from IS NULL), 2, 'attempts made in the Hub have neither mark nor key, and don''t collide');
SELECT isnt(pg_temp.failure($$INSERT INTO public.quiz_attempts (quiz_id, member_id, question_count, correct_count, score_percent, passed, imported_from) VALUES ('quiz_AAAAAAAAQr01', 'mbr_AAAAAAAAQrA2', 0, 0, 0, true, 'kajabi')$$), '', 'an attempt marked from Kajabi needs its key');
SELECT isnt(pg_temp.failure($$INSERT INTO public.quiz_attempts (quiz_id, member_id, question_count, correct_count, score_percent, passed, source_key) VALUES ('quiz_AAAAAAAAQr01', 'mbr_AAAAAAAAQrA2', 0, 0, 0, true, 'k')$$), '', 'and a key needs the mark');
SELECT isnt(pg_temp.failure($$INSERT INTO public.quiz_attempts (quiz_id, member_id, question_count, correct_count, score_percent, passed, imported_from, source_key) VALUES ('quiz_AAAAAAAAQr01', 'mbr_AAAAAAAAQrA2', 0, 0, 0, true, 'elsewhere', 'k')$$), '', 'and the mark is a source we know');

-- Who may run it, and who may read what.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d03a1", "email": "qr-alice@example.test", "role": "authenticated"}', true);
SELECT isnt(pg_temp.failure($$SELECT public.import_quiz_attempt('{"quiz_id":"quiz_AAAAAAAAQr01","member_id":"mbr_AAAAAAAAQrA1","source_key":"x","answers":[]}'::jsonb)$$), '', 'a signed-in member can''t run the import');
SELECT is((SELECT count(*)::int FROM public.quiz_attempt_answers WHERE answer_text IS NOT NULL), 1, 'a member reads the answers of their own imported attempt');
SELECT is(pg_temp.failure($$SELECT count(*) FROM bronze.kajabi_quiz_responses$$) <> '' OR (SELECT count(*) FROM bronze.kajabi_quiz_responses) = 0, true, 'a member reads no Bronze responses');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d03a2", "email": "qr-bob@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.quiz_attempt_answers), 0, 'another member reads none of it');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000d03a4", "email": "qr-dana@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM bronze.kajabi_quiz_responses), 1, 'an admin reads the Bronze responses');
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
