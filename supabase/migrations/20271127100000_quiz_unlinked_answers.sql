-- An imported answer whose question can't be matched to a question of the Hub's quiz (docs/product/COURSES.md, "Importing past
-- quiz responses"). Kajabi's submission view names a question by its title and position, not by the editor's question id, so when
-- a quiz was edited after the answer was given the two may no longer line up. The import never guesses: such an answer is kept on
-- the attempt, with the question's own wording, instead of being attached to a question it may not belong to or dropped. Expand only.
--
--   * quiz_attempts.unlinked_answers: a JSON array of { position, prompt, kind, text, labels, file: { path, name, bytes } }, null
--     when there are none. Readable exactly as the attempt is (its member, and admins); files live in the member's folder.
--   * import_quiz_attempt(): the same function (same signature), now also writing `p_attempt.unlinked`.

set lock_timeout = '5s';

ALTER TABLE public.quiz_attempts ADD COLUMN unlinked_answers jsonb;
ALTER TABLE public.quiz_attempts
  ADD CONSTRAINT quiz_attempts_unlinked_answers_array CHECK (unlinked_answers IS NULL OR jsonb_typeof(unlinked_answers) = 'array') NOT VALID;
ALTER TABLE public.quiz_attempts VALIDATE CONSTRAINT quiz_attempts_unlinked_answers_array;
COMMENT ON COLUMN public.quiz_attempts.unlinked_answers IS
  'Answers imported from Kajabi whose question could not be matched to a question of the Hub''s quiz, kept with their own wording: [{position, prompt, kind, text, labels, file: {path, name, bytes}}]. Null when none.';

CREATE OR REPLACE FUNCTION public.import_quiz_attempt(p_attempt jsonb)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  v_id text;
  v_answer jsonb;
BEGIN
  INSERT INTO quiz_attempts (quiz_id, member_id, question_count, correct_count, score_percent, passed, submitted_at, imported_from, source_key, unlinked_answers)
  VALUES (
    p_attempt ->> 'quiz_id', p_attempt ->> 'member_id', 0, 0, 0, true,
    coalesce((p_attempt ->> 'submitted_at')::timestamptz, now()), 'kajabi', p_attempt ->> 'source_key',
    CASE WHEN jsonb_typeof(p_attempt -> 'unlinked') = 'array' AND jsonb_array_length(p_attempt -> 'unlinked') > 0 THEN p_attempt -> 'unlinked' END
  )
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

NOTIFY pgrst, 'reload schema';
