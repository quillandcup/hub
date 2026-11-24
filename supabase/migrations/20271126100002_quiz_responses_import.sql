-- Past quiz responses imported from Kajabi (docs/product/COURSES.md, "Importing past quiz responses"). Expand only.
--
--   * bronze.kajabi_quiz_responses: one row per submission Kajabi's quiz Results tab lists, as the capture read it
--     (`courses:content --responses`): the member's email (the key to a Hub member; no name is kept), when it was
--     submitted, and each answer (the question as it was worded then, what was picked or written, an uploaded file's
--     source address and where its copy is in storage). Bronze keeps EVERY submission, for every responder, whether or
--     not they are a member now: the point is that leaving Kajabi loses nobody's writing. Admin read, service role write.
--   * public.quiz_attempts.imported_from / source_key: an attempt imported from Kajabi says so, and carries Kajabi's
--     submission key, which with the quiz is unique, so importing again is a no-op and a Hub-made attempt (no key) can never
--     be touched by an import.
--   * public.quiz_attempt_answers.prompt_snapshot: the question as it was worded when the member answered it, since a quiz is
--     edited later (and Kajabi's own submission view showed different wording than its editor).
--   * public.import_quiz_attempt(): the Silver step for one submission, one transaction, insert only: the attempt and its
--     answers, or nothing when that submission is already there. Service role only.

set lock_timeout = '5s';

------------------------------------------------------------------------------------------------
-- Bronze
------------------------------------------------------------------------------------------------

CREATE TABLE bronze.kajabi_quiz_responses (
  -- Kajabi's quiz id (the number in /admin/quizzes/<id>/...) and the submission's key within it.
  quiz_kajabi_id TEXT NOT NULL,
  submission_key TEXT NOT NULL,
  course_kajabi_id TEXT NOT NULL,
  -- Lower case. The only thing that says who answered: matched to a Hub member (or one of their other addresses) when the
  -- responses are imported, and kept in Bronze until there is one.
  email TEXT NOT NULL,
  submitted_at TIMESTAMPTZ,
  -- [ { "question_key": text, "prompt": text|null, "text": text|null, "option_keys": [text], "option_labels": [text],
  --     "file": { "name": text, "bytes": int|null, "source_url": text|null, "storage_path": text|null, "copy_failure": text|null } | null } ]
  answers JSONB NOT NULL,
  -- Over the parsed fields, so an unchanged capture writes nothing.
  content_hash TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (quiz_kajabi_id, submission_key)
);
CREATE INDEX kajabi_quiz_responses_course_idx ON bronze.kajabi_quiz_responses (course_kajabi_id) WHERE deleted_at IS NULL;
CREATE INDEX kajabi_quiz_responses_email_idx ON bronze.kajabi_quiz_responses (email) WHERE deleted_at IS NULL;

ALTER TABLE bronze.kajabi_quiz_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bronze.kajabi_quiz_responses FROM anon, authenticated;
GRANT SELECT ON bronze.kajabi_quiz_responses TO authenticated;
GRANT ALL ON bronze.kajabi_quiz_responses TO service_role;
CREATE POLICY "Admins can read kajabi_quiz_responses" ON bronze.kajabi_quiz_responses
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

COMMENT ON TABLE bronze.kajabi_quiz_responses IS
  'Members'' past quiz submissions as Kajabi''s Results tab showed them, captured by courses:content --responses: their email (no name), the answers and files. Holds members'' own writing: admin read, service role write. Kept for everyone, member or not.';

------------------------------------------------------------------------------------------------
-- Local: an imported attempt says so, and has a key
------------------------------------------------------------------------------------------------

ALTER TABLE public.quiz_attempts
  ADD COLUMN imported_from text,
  ADD COLUMN source_key text;

ALTER TABLE public.quiz_attempts
  ADD CONSTRAINT quiz_attempts_imported_from_check CHECK (imported_from IS NULL OR imported_from = 'kajabi') NOT VALID,
  ADD CONSTRAINT quiz_attempts_import_key_whole CHECK ((imported_from IS NULL) = (source_key IS NULL)) NOT VALID;
ALTER TABLE public.quiz_attempts VALIDATE CONSTRAINT quiz_attempts_imported_from_check;
ALTER TABLE public.quiz_attempts VALIDATE CONSTRAINT quiz_attempts_import_key_whole;
-- One import per submission. A native attempt has no key, and null keys never collide.
ALTER TABLE public.quiz_attempts ADD CONSTRAINT quiz_attempts_quiz_source_key_key UNIQUE (quiz_id, source_key);

COMMENT ON COLUMN public.quiz_attempts.imported_from IS 'kajabi for an attempt imported from Kajabi''s Results tab (never scored, never notified); null for one the member made in the Hub.';
COMMENT ON COLUMN public.quiz_attempts.source_key IS 'Kajabi''s submission key, for an imported attempt.';

ALTER TABLE public.quiz_attempt_answers ADD COLUMN prompt_snapshot text;
COMMENT ON COLUMN public.quiz_attempt_answers.prompt_snapshot IS 'The question as it was worded when it was answered (imported answers always carry it; the quiz may be edited later).';

------------------------------------------------------------------------------------------------
-- Silver: one imported submission, insert only
------------------------------------------------------------------------------------------------

-- p_attempt: { "quiz_id", "member_id", "source_key", "submitted_at": timestamptz text,
--   "answers": [ { "question_id", "selected_option_ids": [text], "answer_text": text|null, "prompt_snapshot": text|null,
--                  "file_path": text|null, "file_name": text|null, "file_bytes": int|null } ] }.
-- Returns 'inserted', or 'exists' when that submission was imported before (nothing is changed then, so an attempt made in the Hub
-- or an import already there is never overwritten). The attempt is not scored (question_count 0) and counts as passed: it is the
-- record of what the member wrote, and whether it completed the lesson is the import's own check.
CREATE FUNCTION public.import_quiz_attempt(p_attempt jsonb)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  v_id text;
  v_answer jsonb;
BEGIN
  INSERT INTO quiz_attempts (quiz_id, member_id, question_count, correct_count, score_percent, passed, submitted_at, imported_from, source_key)
  VALUES (p_attempt ->> 'quiz_id', p_attempt ->> 'member_id', 0, 0, 0, true, coalesce((p_attempt ->> 'submitted_at')::timestamptz, now()), 'kajabi', p_attempt ->> 'source_key')
  ON CONFLICT (quiz_id, source_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN 'exists';
  END IF;

  FOR v_answer IN SELECT * FROM jsonb_array_elements(coalesce(p_attempt -> 'answers', '[]'::jsonb)) LOOP
    INSERT INTO quiz_attempt_answers (attempt_id, question_id, selected_option_ids, is_correct, answer_text, prompt_snapshot, file_path, file_name, file_bytes)
    VALUES (
      v_id,
      v_answer ->> 'question_id',
      coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(v_answer -> 'selected_option_ids', '[]'::jsonb))), '{}'),
      NULL,
      v_answer ->> 'answer_text',
      v_answer ->> 'prompt_snapshot',
      v_answer ->> 'file_path',
      v_answer ->> 'file_name',
      (v_answer ->> 'file_bytes')::integer
    )
    ON CONFLICT (attempt_id, question_id) DO NOTHING;
  END LOOP;
  RETURN 'inserted';
END $$;

REVOKE ALL ON FUNCTION public.import_quiz_attempt(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_quiz_attempt(jsonb) TO service_role;
COMMENT ON FUNCTION public.import_quiz_attempt(jsonb) IS
  'The Silver step for one Kajabi quiz submission: inserts the attempt and its answers in one transaction, or does nothing when it is already there. Service role only.';

NOTIFY pgrst, 'reload schema';
