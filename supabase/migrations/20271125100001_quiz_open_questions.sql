-- Quiz questions that are not graded: short answer, file upload, and choice questions with no right answer
-- (docs/product/COURSES.md, "Quizzes"). Expand only: new columns with defaults that keep every existing row what it was
-- (a graded choice question), a new private bucket, new functions; nothing existing is removed or retyped.
--
--   * quiz_questions.kind: 'choice' (multiple choice or checkboxes, as before), 'short_answer' (free text) or
--     'file_upload' (one file). quiz_questions.graded: whether the question counts toward the score. Only a choice
--     question can be graded (the Hub scores nothing by hand), so a short answer or a file upload is never graded.
--   * quiz_attempt_answers keeps what a member wrote (answer_text) or uploaded (file_path, file_name, file_bytes).
--     That is the member's own writing: they read it, staff read it, nobody else. Row-level security on the answers
--     already says that (a member reads their own attempts' answers, admins read all, nobody writes with a user client).
--   * The files live in a PRIVATE bucket, `quiz-answer-files`, with no storage policy at all, so only the server
--     (service role) reaches it; it hands a file out after checking the caller is the member or staff
--     (the course quiz answer route). A file is `<member id>/<random>/<name>`, so a removal request deletes a
--     member's whole folder. At most 10 MB, enforced by the bucket itself.
--   * A removal request now DELETES a member's quiz attempts (it used to re-point them at the former-member
--     placeholder): an attempt can hold their own words and files, which identify them.
--   * save_quiz_question_of_kind(): the builder's write for every kind. The five-argument save_quiz_question stays,
--     as a wrapper for a choice question, until the code that calls it is gone (contract step: docs/TODO.md).
--   * sync_imported_quiz(): the Kajabi Silver step reads the two new fields (same signature; a payload without them
--     means a graded choice question, as before).

set lock_timeout = '5s';

------------------------------------------------------------------------------------------------
-- Columns
------------------------------------------------------------------------------------------------

ALTER TABLE public.quiz_questions
  ADD COLUMN kind text NOT NULL DEFAULT 'choice',
  ADD COLUMN graded boolean NOT NULL DEFAULT true;

ALTER TABLE public.quiz_questions
  ADD CONSTRAINT quiz_questions_kind_check CHECK (kind IN ('choice', 'short_answer', 'file_upload')) NOT VALID,
  ADD CONSTRAINT quiz_questions_open_not_graded CHECK (kind = 'choice' OR NOT graded) NOT VALID;
ALTER TABLE public.quiz_questions VALIDATE CONSTRAINT quiz_questions_kind_check;
ALTER TABLE public.quiz_questions VALIDATE CONSTRAINT quiz_questions_open_not_graded;

COMMENT ON COLUMN public.quiz_questions.kind IS
  'choice (multiple choice or checkboxes), short_answer (free text) or file_upload (one file). Only choice has options.';
COMMENT ON COLUMN public.quiz_questions.graded IS
  'Whether the question counts toward the score. A short answer or a file upload is never graded; a choice question is graded only when it has a right answer marked.';

ALTER TABLE public.quiz_attempt_answers
  ADD COLUMN answer_text text,
  ADD COLUMN file_path text,
  ADD COLUMN file_name text,
  ADD COLUMN file_bytes integer;

ALTER TABLE public.quiz_attempt_answers
  ADD CONSTRAINT quiz_attempt_answers_text_length CHECK (answer_text IS NULL OR char_length(answer_text) <= 20000) NOT VALID,
  ADD CONSTRAINT quiz_attempt_answers_file_whole CHECK (
    (file_path IS NULL AND file_name IS NULL AND file_bytes IS NULL)
    OR (file_path IS NOT NULL AND file_name IS NOT NULL AND file_bytes IS NOT NULL AND file_bytes BETWEEN 0 AND 10485760)
  ) NOT VALID;
ALTER TABLE public.quiz_attempt_answers VALIDATE CONSTRAINT quiz_attempt_answers_text_length;
ALTER TABLE public.quiz_attempt_answers VALIDATE CONSTRAINT quiz_attempt_answers_file_whole;

COMMENT ON COLUMN public.quiz_attempt_answers.answer_text IS
  'What the member typed for a short answer question: their own writing, readable by them and staff only. Redacted in nothing (the table is not audited).';
COMMENT ON COLUMN public.quiz_attempt_answers.file_path IS
  'Object path of the member''s uploaded file in the private quiz-answer-files bucket (<member id>/<random>/<name>). Written only by the server.';

------------------------------------------------------------------------------------------------
-- The private bucket: no policy, only the service role reaches it (supabase/tests/database/storage_buckets.test.sql)
------------------------------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('quiz-answer-files', 'quiz-answer-files', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

------------------------------------------------------------------------------------------------
-- A removal request deletes a member's attempts, with the words and files in them
------------------------------------------------------------------------------------------------

UPDATE public.member_data_handling
   SET action = 'delete',
       why = 'an attempt can hold what the member wrote and uploaded, which is theirs: it goes with them (their files are deleted from storage by the removal)'
 WHERE table_name = 'quiz_attempts' AND column_name = 'member_id';

------------------------------------------------------------------------------------------------
-- Saving a question of any kind (SECURITY INVOKER, like the function it replaces: the policies decide what the caller may touch)
------------------------------------------------------------------------------------------------

-- p_kind: choice | short_answer | file_upload. A short answer or file upload has no options and is not graded. A choice question
-- has 2 to 12 options; when graded it needs a right answer (exactly one unless p_allows_multiple), when not graded no option is
-- marked right (the marks are dropped). The kind of an existing question can't change (delete it and add another).
-- Errors: invalid_question (the shape is wrong), not_found (no such quiz or question, or not one the caller may edit).
CREATE FUNCTION public.save_quiz_question_of_kind(p_quiz_id text, p_question_id text, p_prompt text, p_kind text, p_graded boolean, p_allows_multiple boolean, p_options jsonb)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  v_qid text := p_question_id;
  v_count integer;
  v_correct integer;
  v_opt jsonb;
  v_ord integer;
  v_oid text;
  v_options jsonb := coalesce(p_options, '[]'::jsonb);
  v_graded boolean;
BEGIN
  IF p_prompt IS NULL OR length(btrim(p_prompt)) = 0 OR length(btrim(p_prompt)) > 1000
     OR p_kind IS NULL OR p_kind NOT IN ('choice', 'short_answer', 'file_upload')
     OR p_graded IS NULL OR p_allows_multiple IS NULL OR jsonb_typeof(v_options) <> 'array' THEN
    RAISE EXCEPTION 'invalid_question';
  END IF;
  v_count := jsonb_array_length(v_options);
  v_graded := p_graded;

  IF p_kind = 'choice' THEN
    IF v_count < 2 OR v_count > 12 THEN
      RAISE EXCEPTION 'invalid_question';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_options) o
                WHERE jsonb_typeof(o -> 'label') IS DISTINCT FROM 'string'
                   OR length(btrim(o ->> 'label')) = 0 OR length(btrim(o ->> 'label')) > 500
                   OR jsonb_typeof(o -> 'is_correct') IS DISTINCT FROM 'boolean') THEN
      RAISE EXCEPTION 'invalid_question';
    END IF;
    SELECT count(*) INTO v_correct FROM jsonb_array_elements(v_options) o WHERE (o ->> 'is_correct')::boolean;
    IF p_graded AND (v_correct < 1 OR (NOT p_allows_multiple AND v_correct <> 1)) THEN
      RAISE EXCEPTION 'invalid_question';
    END IF;
  ELSE
    -- Nothing to choose from, nothing to score.
    IF v_count <> 0 OR p_graded OR p_allows_multiple THEN
      RAISE EXCEPTION 'invalid_question';
    END IF;
  END IF;

  -- The quiz must be visible (an admin) and a Hub-owned one: row-level security hides the rest.
  IF NOT EXISTS (SELECT 1 FROM quizzes WHERE id = p_quiz_id) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_qid IS NULL THEN
    INSERT INTO quiz_questions (quiz_id, position, prompt, kind, graded, allows_multiple)
    VALUES (p_quiz_id, (SELECT coalesce(max(position), 0) + 1 FROM quiz_questions WHERE quiz_id = p_quiz_id), btrim(p_prompt), p_kind, v_graded, p_allows_multiple)
    RETURNING id INTO v_qid;
  ELSE
    UPDATE quiz_questions SET prompt = btrim(p_prompt), graded = v_graded, allows_multiple = p_allows_multiple
      WHERE id = v_qid AND quiz_id = p_quiz_id AND kind = p_kind;
    IF NOT FOUND THEN
      -- Not there, or there with another kind: a different kind is a different question.
      IF EXISTS (SELECT 1 FROM quiz_questions WHERE id = v_qid AND quiz_id = p_quiz_id) THEN
        RAISE EXCEPTION 'invalid_question';
      END IF;
      RAISE EXCEPTION 'not_found';
    END IF;
    DELETE FROM quiz_options WHERE question_id = v_qid
      AND id NOT IN (SELECT o ->> 'id' FROM jsonb_array_elements(v_options) o WHERE o ->> 'id' IS NOT NULL);
  END IF;

  v_ord := 0;
  FOR v_opt IN SELECT * FROM jsonb_array_elements(v_options) LOOP
    v_ord := v_ord + 1;
    v_oid := v_opt ->> 'id';
    IF v_oid IS NOT NULL THEN
      UPDATE quiz_options SET position = v_ord, label = btrim(v_opt ->> 'label'), is_correct = p_graded AND (v_opt ->> 'is_correct')::boolean
        WHERE id = v_oid AND question_id = v_qid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_question';
      END IF;
    ELSE
      INSERT INTO quiz_options (question_id, position, label, is_correct)
      VALUES (v_qid, v_ord, btrim(v_opt ->> 'label'), p_graded AND (v_opt ->> 'is_correct')::boolean);
    END IF;
  END LOOP;

  UPDATE quizzes SET revision = revision + 1 WHERE id = p_quiz_id;
  RETURN v_qid;
END $$;

REVOKE ALL ON FUNCTION public.save_quiz_question_of_kind(text, text, text, text, boolean, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_quiz_question_of_kind(text, text, text, text, boolean, boolean, jsonb) TO authenticated;

-- The five-argument function the code deployed before this change calls: a graded choice question, through the one rule above.
CREATE OR REPLACE FUNCTION public.save_quiz_question(p_quiz_id text, p_question_id text, p_prompt text, p_allows_multiple boolean, p_options jsonb)
  RETURNS text
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public
AS $$
  SELECT public.save_quiz_question_of_kind(p_quiz_id, p_question_id, p_prompt, 'choice', true, p_allows_multiple, p_options);
$$;

------------------------------------------------------------------------------------------------
-- Kajabi's Silver step: kind and graded travel with each question (as sync_imported_quiz of 20271124400000, plus those two)
------------------------------------------------------------------------------------------------

-- p_quiz.questions[]: { "source_key", "prompt", "kind": "choice"|"short_answer"|"file_upload" (default choice),
--   "graded": bool (default true for a choice question, false for the others), "allows_multiple", "options": [...] }.
CREATE OR REPLACE FUNCTION public.sync_imported_quiz(p_lesson_id text, p_quiz jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  v_quiz_id text;
  v_question jsonb;
  v_option jsonb;
  v_qid text;
  v_kind text;
  v_graded boolean;
  v_qpos integer := 0;
  v_opos integer;
  v_questions integer := 0;
  v_options integer := 0;
  v_removed integer;
  v_keys text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM course_lessons WHERE id = p_lesson_id AND source = 'kajabi') THEN
    RETURN jsonb_build_object('status', 'skipped', 'questions', 0, 'options', 0, 'removed_questions', 0);
  END IF;

  UPDATE quizzes q SET source_key = NULL
    FROM course_lessons l
    WHERE l.id = q.lesson_id AND q.source_key = p_quiz ->> 'source_key' AND q.lesson_id <> p_lesson_id AND l.source <> 'kajabi';

  INSERT INTO quizzes (lesson_id, passing_percent, hide_answers, source_key)
  VALUES (p_lesson_id, (p_quiz ->> 'passing_percent')::smallint, coalesce((p_quiz ->> 'hide_answers')::boolean, false), p_quiz ->> 'source_key')
  ON CONFLICT (lesson_id) DO UPDATE
    SET passing_percent = EXCLUDED.passing_percent, hide_answers = EXCLUDED.hide_answers, source_key = EXCLUDED.source_key
    WHERE (quizzes.passing_percent, quizzes.hide_answers, quizzes.source_key) IS DISTINCT FROM (EXCLUDED.passing_percent, EXCLUDED.hide_answers, EXCLUDED.source_key);
  SELECT id INTO v_quiz_id FROM quizzes WHERE lesson_id = p_lesson_id;

  FOR v_question IN SELECT * FROM jsonb_array_elements(coalesce(p_quiz -> 'questions', '[]'::jsonb)) LOOP
    v_qpos := v_qpos + 1;
    v_qid := NULL;
    v_kind := coalesce(v_question ->> 'kind', 'choice');
    -- Only a choice question can be graded.
    v_graded := v_kind = 'choice' AND coalesce((v_question ->> 'graded')::boolean, true);
    INSERT INTO quiz_questions (quiz_id, position, prompt, kind, graded, allows_multiple, source_key)
    VALUES (v_quiz_id, v_qpos, btrim(v_question ->> 'prompt'), v_kind, v_graded, coalesce((v_question ->> 'allows_multiple')::boolean, false), v_question ->> 'source_key')
    ON CONFLICT (quiz_id, source_key) WHERE source_key IS NOT NULL DO UPDATE
      SET position = EXCLUDED.position, prompt = EXCLUDED.prompt, kind = EXCLUDED.kind, graded = EXCLUDED.graded, allows_multiple = EXCLUDED.allows_multiple
      WHERE (quiz_questions.position, quiz_questions.prompt, quiz_questions.kind, quiz_questions.graded, quiz_questions.allows_multiple)
        IS DISTINCT FROM (EXCLUDED.position, EXCLUDED.prompt, EXCLUDED.kind, EXCLUDED.graded, EXCLUDED.allows_multiple)
    RETURNING id INTO v_qid;
    IF v_qid IS NULL THEN
      SELECT id INTO v_qid FROM quiz_questions WHERE quiz_id = v_quiz_id AND source_key = v_question ->> 'source_key';
    END IF;
    v_questions := v_questions + 1;

    v_opos := 0;
    FOR v_option IN SELECT * FROM jsonb_array_elements(CASE WHEN v_kind = 'choice' THEN coalesce(v_question -> 'options', '[]'::jsonb) ELSE '[]'::jsonb END) LOOP
      v_opos := v_opos + 1;
      INSERT INTO quiz_options (question_id, position, label, is_correct, source_key)
      VALUES (v_qid, v_opos, btrim(v_option ->> 'label'), v_graded AND coalesce((v_option ->> 'is_correct')::boolean, false), v_option ->> 'source_key')
      ON CONFLICT (question_id, source_key) WHERE source_key IS NOT NULL DO UPDATE
        SET position = EXCLUDED.position, label = EXCLUDED.label, is_correct = EXCLUDED.is_correct
        WHERE (quiz_options.position, quiz_options.label, quiz_options.is_correct) IS DISTINCT FROM (EXCLUDED.position, EXCLUDED.label, EXCLUDED.is_correct);
      v_options := v_options + 1;
    END LOOP;
    -- Options Kajabi dropped from this question (all of them when it is not a choice question any more).
    SELECT coalesce(array_agg(o ->> 'source_key'), '{}') INTO v_keys
      FROM jsonb_array_elements(CASE WHEN v_kind = 'choice' THEN coalesce(v_question -> 'options', '[]'::jsonb) ELSE '[]'::jsonb END) o;
    DELETE FROM quiz_options WHERE question_id = v_qid AND source_key IS NOT NULL AND source_key <> ALL (v_keys);
  END LOOP;

  SELECT coalesce(array_agg(q ->> 'source_key'), '{}') INTO v_keys FROM jsonb_array_elements(coalesce(p_quiz -> 'questions', '[]'::jsonb)) q;
  DELETE FROM quiz_questions WHERE quiz_id = v_quiz_id AND source_key IS NOT NULL AND source_key <> ALL (v_keys);
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  RETURN jsonb_build_object('status', 'synced', 'questions', v_questions, 'options', v_options, 'removed_questions', v_removed);
END $$;

NOTIFY pgrst, 'reload schema';
