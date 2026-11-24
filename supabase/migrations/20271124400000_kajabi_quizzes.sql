-- Quizzes imported from Kajabi (docs/product/COURSES.md, "Quizzes"). Expand only.
--
--   * bronze.kajabi_quizzes: what the lesson capture (`npm run courses:content`) read from Kajabi's quiz editor, as it
--     came (raw_payload), one row per Kajabi quiz. Bronze keeps the raw documents, so a better reading of them
--     is a reprocess, not a new capture in a logged-in browser. The capture soft-deletes a quiz whose lesson is
--     a plain lesson again.
--   * public.sync_imported_quiz(): the Silver step for one quiz, in one transaction, run by the processing route
--     with the service role: upserts the quiz of a Kajabi lesson and its questions and options on their Kajabi keys
--     (so a member's attempts keep pointing at the same rows when nothing changed) and removes the ones Kajabi no longer
--     lists. It never touches a lesson that is not Kajabi's (taking a course over from Kajabi flips the lessons, which
--     stops the import and lets staff edit the quiz).

set lock_timeout = '5s';

CREATE TABLE bronze.kajabi_quizzes (
  -- Kajabi's quiz id (the number in /admin/quizzes/<id>/edit).
  kajabi_id TEXT PRIMARY KEY,
  course_kajabi_id TEXT NOT NULL,
  -- Kajabi's post id of the lesson in the course outline (it redirects to the quiz); equals bronze.kajabi_course_lessons.kajabi_id.
  lesson_kajabi_id TEXT NOT NULL,
  -- The JSON the quiz editor loaded: { "documents": [ ... ] } (the page's embedded store and its quiz API responses).
  raw_payload JSONB NOT NULL,
  -- Over the documents, so an unchanged capture writes nothing.
  content_hash TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX kajabi_quizzes_course_idx ON bronze.kajabi_quizzes (course_kajabi_id) WHERE deleted_at IS NULL;
CREATE INDEX kajabi_quizzes_lesson_idx ON bronze.kajabi_quizzes (lesson_kajabi_id) WHERE deleted_at IS NULL;

ALTER TABLE bronze.kajabi_quizzes ENABLE ROW LEVEL SECURITY;
-- Default privileges in this schema would otherwise hand the new table to anon and authenticated.
REVOKE ALL ON bronze.kajabi_quizzes FROM anon, authenticated;
GRANT SELECT ON bronze.kajabi_quizzes TO authenticated;
GRANT ALL ON bronze.kajabi_quizzes TO service_role;
CREATE POLICY "Admins can read kajabi_quizzes" ON bronze.kajabi_quizzes
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

COMMENT ON TABLE bronze.kajabi_quizzes IS
  'Kajabi quizzes as the quiz editor delivered them, captured by courses:content (one row per quiz, natural key). Holds the right answers: admin read, service role write.';

------------------------------------------------------------------------------------------------
-- Silver: one imported quiz, whole
------------------------------------------------------------------------------------------------

-- p_quiz: {
--   "source_key": "<Kajabi quiz id>", "passing_percent": 1..100 or null, "hide_answers": bool,
--   "questions": [ { "source_key", "prompt", "allows_multiple", "options": [ { "source_key", "label", "is_correct" } ] } ]
-- } in order. Returns { "status": "synced" | "skipped", "questions": n, "options": n, "removed_questions": n }.
-- "skipped": the lesson isn't there or isn't Kajabi's. Rows whose content already matches are not rewritten.
CREATE FUNCTION public.sync_imported_quiz(p_lesson_id text, p_quiz jsonb)
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

  -- A quiz taken over from Kajabi keeps its Kajabi key only as a note; if this lesson now claims that Kajabi quiz (a course
  -- imported again after a take-over), the key moves here instead of failing the whole run on the unique key.
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
    INSERT INTO quiz_questions (quiz_id, position, prompt, allows_multiple, source_key)
    VALUES (v_quiz_id, v_qpos, btrim(v_question ->> 'prompt'), coalesce((v_question ->> 'allows_multiple')::boolean, false), v_question ->> 'source_key')
    ON CONFLICT (quiz_id, source_key) WHERE source_key IS NOT NULL DO UPDATE
      SET position = EXCLUDED.position, prompt = EXCLUDED.prompt, allows_multiple = EXCLUDED.allows_multiple
      WHERE (quiz_questions.position, quiz_questions.prompt, quiz_questions.allows_multiple) IS DISTINCT FROM (EXCLUDED.position, EXCLUDED.prompt, EXCLUDED.allows_multiple)
    RETURNING id INTO v_qid;
    IF v_qid IS NULL THEN
      SELECT id INTO v_qid FROM quiz_questions WHERE quiz_id = v_quiz_id AND source_key = v_question ->> 'source_key';
    END IF;
    v_questions := v_questions + 1;

    v_opos := 0;
    FOR v_option IN SELECT * FROM jsonb_array_elements(coalesce(v_question -> 'options', '[]'::jsonb)) LOOP
      v_opos := v_opos + 1;
      INSERT INTO quiz_options (question_id, position, label, is_correct, source_key)
      VALUES (v_qid, v_opos, btrim(v_option ->> 'label'), coalesce((v_option ->> 'is_correct')::boolean, false), v_option ->> 'source_key')
      ON CONFLICT (question_id, source_key) WHERE source_key IS NOT NULL DO UPDATE
        SET position = EXCLUDED.position, label = EXCLUDED.label, is_correct = EXCLUDED.is_correct
        WHERE (quiz_options.position, quiz_options.label, quiz_options.is_correct) IS DISTINCT FROM (EXCLUDED.position, EXCLUDED.label, EXCLUDED.is_correct);
      v_options := v_options + 1;
    END LOOP;
    -- Options Kajabi dropped from this question.
    SELECT coalesce(array_agg(o ->> 'source_key'), '{}') INTO v_keys FROM jsonb_array_elements(coalesce(v_question -> 'options', '[]'::jsonb)) o;
    DELETE FROM quiz_options WHERE question_id = v_qid AND source_key IS NOT NULL AND source_key <> ALL (v_keys);
  END LOOP;

  -- Questions Kajabi dropped (their options and the answers members gave to them go too; attempts keep their scores).
  SELECT coalesce(array_agg(q ->> 'source_key'), '{}') INTO v_keys FROM jsonb_array_elements(coalesce(p_quiz -> 'questions', '[]'::jsonb)) q;
  DELETE FROM quiz_questions WHERE quiz_id = v_quiz_id AND source_key IS NOT NULL AND source_key <> ALL (v_keys);
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  RETURN jsonb_build_object('status', 'synced', 'questions', v_questions, 'options', v_options, 'removed_questions', v_removed);
END $$;

-- Only the processing route (service role) syncs imports; nobody signed in calls it.
REVOKE ALL ON FUNCTION public.sync_imported_quiz(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_imported_quiz(text, jsonb) TO service_role;

COMMENT ON FUNCTION public.sync_imported_quiz(text, jsonb) IS
  'The Silver step for one Kajabi quiz: upserts the quiz of a Kajabi lesson with its questions and options on their Kajabi keys and removes what Kajabi dropped, in one transaction. Service role only.';

NOTIFY pgrst, 'reload schema';
