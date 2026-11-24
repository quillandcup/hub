-- Quizzes in courses (docs/product/COURSES.md, "Quizzes"). Expand only: new tables, one new guard trigger.
--
-- A lesson is a quiz lesson when a `quizzes` row points at it (one per lesson). The lesson keeps its title,
-- text, thumbnail, status and place in the outline, so quizzes ride on every lesson feature (draft, coming
-- soon, reorder, progress, locks) without a second kind of outline item. A quiz has questions, a question has
-- options with one or more marked correct, and each attempt a member submits is stored with the score it got.
--
-- Who may do what:
--   * Staff (admins) read everything and write the quizzes of Hub-owned lessons, with their own client, so the
--     audit log names them (policies below; an imported lesson's quiz is written by the Kajabi processing run
--     with the service role, and becomes editable when the course is taken over, because the policy reads the
--     lesson's source).
--   * Members have NO access to questions or options: `is_correct` must never reach a browser before an
--     attempt is submitted. The app reads them with the service role after its own access check, and scores
--     on the server. Members read only their own attempts (and the answers in them).
--   * Attempts and answers are written by the service role only (the server scores, then records).
--
-- Passing is what completes a quiz lesson. Members write `lesson_progress` as themselves, so the trigger at the
-- end stops a member's own client from marking a quiz lesson complete directly: only the server, after scoring,
-- does it.

set lock_timeout = '5s';

------------------------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------------------------

CREATE TABLE public.quizzes (
  id text PRIMARY KEY DEFAULT public.new_id('quiz'),
  lesson_id text NOT NULL UNIQUE REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  -- Null: not graded, any submitted attempt completes the lesson. Otherwise the percent of questions that must be
  -- answered fully correctly.
  passing_percent smallint CHECK (passing_percent BETWEEN 1 AND 100),
  -- When true a member sees their score but not which answers were right.
  hide_answers boolean NOT NULL DEFAULT false,
  -- Counts edits to the quiz's questions, so the audit log records "the questions were edited" as one entry for
  -- the quiz instead of a row per option.
  revision integer NOT NULL DEFAULT 0,
  -- Kajabi's quiz id when the quiz was imported from Kajabi (the key the processing run upserts on).
  source_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.quizzes IS
  'Local/Silver: the quiz of a quiz lesson (one per lesson). Settings only; title, text and status are the lesson''s. [id prefix: quiz_]';
CREATE UNIQUE INDEX quizzes_source_key_key ON public.quizzes (source_key) WHERE source_key IS NOT NULL;

CREATE TABLE public.quiz_questions (
  id text PRIMARY KEY DEFAULT public.new_id('qques'),
  quiz_id text NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 1,
  prompt text NOT NULL CHECK (length(btrim(prompt)) BETWEEN 1 AND 1000),
  -- false: choose one answer; true: choose every answer that applies (all-or-nothing).
  allows_multiple boolean NOT NULL DEFAULT false,
  source_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.quiz_questions IS
  'Local/Silver: the questions of a quiz, in order. [id prefix: qques_]';
CREATE INDEX quiz_questions_quiz_idx ON public.quiz_questions (quiz_id, position);
CREATE UNIQUE INDEX quiz_questions_source_key_key ON public.quiz_questions (quiz_id, source_key) WHERE source_key IS NOT NULL;

CREATE TABLE public.quiz_options (
  id text PRIMARY KEY DEFAULT public.new_id('qopt'),
  question_id text NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 1,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 500),
  is_correct boolean NOT NULL DEFAULT false,
  source_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.quiz_options IS
  'Local/Silver: the answers a member can pick for a question; is_correct is never sent to a member before they submit. [id prefix: qopt_]';
CREATE INDEX quiz_options_question_idx ON public.quiz_options (question_id, position);
CREATE UNIQUE INDEX quiz_options_source_key_key ON public.quiz_options (question_id, source_key) WHERE source_key IS NOT NULL;

CREATE TABLE public.quiz_attempts (
  id text PRIMARY KEY DEFAULT public.new_id('qatt'),
  quiz_id text NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  -- The score as it was when the attempt was submitted: editing the quiz later never changes it.
  -- How many questions were scored (a question with no correct answer marked is not) and how many were fully right.
  question_count integer NOT NULL CHECK (question_count >= 0),
  correct_count integer NOT NULL CHECK (correct_count >= 0 AND correct_count <= question_count),
  score_percent smallint NOT NULL CHECK (score_percent BETWEEN 0 AND 100),
  -- Whether it counted as a pass: true for any attempt when the quiz had no passing grade.
  passed boolean NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.quiz_attempts IS
  'Local: one row per submitted attempt of a member, with its score (member data: never in logs or exports without care). [id prefix: qatt_]';
CREATE INDEX quiz_attempts_quiz_member_idx ON public.quiz_attempts (quiz_id, member_id, submitted_at);
CREATE INDEX quiz_attempts_member_idx ON public.quiz_attempts (member_id);

CREATE TABLE public.quiz_attempt_answers (
  attempt_id text NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  -- What the member picked (option ids), empty when they skipped it.
  selected_option_ids text[] NOT NULL DEFAULT '{}',
  -- Null when the question had no correct answer marked, so it was not scored (an imported question can lack one).
  is_correct boolean,
  PRIMARY KEY (attempt_id, question_id)
);
COMMENT ON TABLE public.quiz_attempt_answers IS
  'Local: what a member picked for each question of an attempt, and whether it was right. Keyed by its references.';
CREATE INDEX quiz_attempt_answers_question_idx ON public.quiz_attempt_answers (question_id);

CREATE TRIGGER update_quizzes_updated_at BEFORE UPDATE ON public.quizzes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quiz_questions_updated_at BEFORE UPDATE ON public.quiz_questions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quiz_options_updated_at BEFORE UPDATE ON public.quiz_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

------------------------------------------------------------------------------------------------
-- RLS and grants
------------------------------------------------------------------------------------------------

ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempt_answers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.quizzes, public.quiz_questions, public.quiz_options, public.quiz_attempts, public.quiz_attempt_answers FROM anon, authenticated;
GRANT ALL ON public.quizzes, public.quiz_questions, public.quiz_options, public.quiz_attempts, public.quiz_attempt_answers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quizzes, public.quiz_questions, public.quiz_options TO authenticated;
GRANT SELECT ON public.quiz_attempts, public.quiz_attempt_answers TO authenticated;

-- Staff read all of it. Members get no policy on questions or options: the server reads them.
-- A member reads a quiz's settings (passing grade, whether answers are hidden) only for a lesson they can read: row-level
-- security on lessons already limits them to the open lessons of courses they have access to.
CREATE POLICY "Members read quizzes of lessons they can read, admins all" ON public.quizzes FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()) OR EXISTS (SELECT 1 FROM public.course_lessons l WHERE l.id = lesson_id));
CREATE POLICY "Admins read quiz questions" ON public.quiz_questions FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins read quiz options" ON public.quiz_options FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- Staff write the quizzes of Hub-owned lessons only (the lesson's `source`, so taking a course over from Kajabi
-- makes its quizzes editable and an imported course's stay read only).
CREATE POLICY "Admins create hub quizzes" ON public.quizzes FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin())
    AND EXISTS (SELECT 1 FROM public.course_lessons l WHERE l.id = lesson_id AND l.source = 'hub'));
CREATE POLICY "Admins edit hub quizzes" ON public.quizzes FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())
    AND EXISTS (SELECT 1 FROM public.course_lessons l WHERE l.id = lesson_id AND l.source = 'hub'))
  WITH CHECK ((SELECT public.is_admin())
    AND EXISTS (SELECT 1 FROM public.course_lessons l WHERE l.id = lesson_id AND l.source = 'hub'));
CREATE POLICY "Admins delete hub quizzes" ON public.quizzes FOR DELETE TO authenticated
  USING ((SELECT public.is_admin())
    AND EXISTS (SELECT 1 FROM public.course_lessons l WHERE l.id = lesson_id AND l.source = 'hub'));

CREATE POLICY "Admins write hub quiz questions" ON public.quiz_questions FOR ALL TO authenticated
  USING ((SELECT public.is_admin())
    AND EXISTS (SELECT 1 FROM public.quizzes q JOIN public.course_lessons l ON l.id = q.lesson_id WHERE q.id = quiz_id AND l.source = 'hub'))
  WITH CHECK ((SELECT public.is_admin())
    AND EXISTS (SELECT 1 FROM public.quizzes q JOIN public.course_lessons l ON l.id = q.lesson_id WHERE q.id = quiz_id AND l.source = 'hub'));
CREATE POLICY "Admins write hub quiz options" ON public.quiz_options FOR ALL TO authenticated
  USING ((SELECT public.is_admin())
    AND EXISTS (SELECT 1 FROM public.quiz_questions qq JOIN public.quizzes q ON q.id = qq.quiz_id JOIN public.course_lessons l ON l.id = q.lesson_id WHERE qq.id = question_id AND l.source = 'hub'))
  WITH CHECK ((SELECT public.is_admin())
    AND EXISTS (SELECT 1 FROM public.quiz_questions qq JOIN public.quizzes q ON q.id = qq.quiz_id JOIN public.course_lessons l ON l.id = q.lesson_id WHERE qq.id = question_id AND l.source = 'hub'));

-- Attempts: a member reads their own, staff read all. Nobody writes them with a user client.
CREATE POLICY "Members read their own quiz attempts, admins all" ON public.quiz_attempts FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Members read the answers of their own attempts, admins all" ON public.quiz_attempt_answers FOR SELECT TO authenticated
  USING ((SELECT public.is_admin())
    OR EXISTS (SELECT 1 FROM public.quiz_attempts a WHERE a.id = attempt_id AND a.member_id = (SELECT public.current_member_id())));

------------------------------------------------------------------------------------------------
-- Audit: one entry per intent, written for signed-in people only (the Kajabi processing run, which writes as the
-- service role, rebuilds imported quizzes every time and would only be noise). Options and questions are not
-- audited row by row: every edit of them goes through the functions below, which bump `quizzes.revision`, so
-- the quiz's own entry says "the questions were edited". Question text is never in the log.
------------------------------------------------------------------------------------------------

CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.quizzes
  FOR EACH ROW WHEN (auth.uid() IS NOT NULL)
  EXECUTE FUNCTION audit_row_change('quiz', 'id');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.quizzes
  FOR EACH ROW WHEN (auth.uid() IS NOT NULL AND (to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))
  EXECUTE FUNCTION audit_row_change('quiz', 'id');
CREATE TRIGGER audit_row_change_delete
  AFTER DELETE ON public.quizzes
  FOR EACH ROW WHEN (auth.uid() IS NOT NULL)
  EXECUTE FUNCTION audit_row_change('quiz', 'id');

-- The Activity Log names a quiz by its lesson: audit_entity_label() as of 20271028000000, plus the 'quiz' case.
CREATE OR REPLACE FUNCTION public.audit_entity_label(entity text, subject jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT left(COALESCE(
        CASE entity
            WHEN 'member_badge' THEN (SELECT b.name FROM badge_types b WHERE b.id = (subject ->> 'badge_type_id'))
            WHEN 'event' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'id'))
            WHEN 'event_attendee' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'event_id'))
            WHEN 'event_photo' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'event_id'))
            WHEN 'segment_member' THEN (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id'))
            WHEN 'feature_flag' THEN subject ->> 'feature_key'
            WHEN 'user_feature_preview' THEN subject ->> 'feature_key'
            WHEN 'feature_flag_segment' THEN
                concat_ws(' · ', subject ->> 'feature_key', (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id')))
            WHEN 'program_cohort' THEN
                concat_ws(' · ', (SELECT p.name FROM programs p WHERE p.id = (subject ->> 'program_id')), subject ->> 'name')
            WHEN 'program_enrollment' THEN
                (SELECT concat_ws(' · ', p.name, c.name) FROM program_cohorts c JOIN programs p ON p.id = c.program_id
                  WHERE c.id = (subject ->> 'cohort_id')::uuid)
            WHEN 'prickle_schedule' THEN
                concat_ws(' · ', (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id')), subject ->> 'month')
            WHEN 'prickle_host_vibe' THEN (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id'))
            WHEN 'user_profile' THEN subject ->> 'email'
            WHEN 'user_role' THEN (SELECT up.email FROM user_profiles up WHERE up.id = (subject ->> 'user_id')::uuid)
            WHEN 'member_email_alias' THEN subject ->> 'alias_email'
            WHEN 'member_status_override' THEN subject ->> 'override_type'
            WHEN 'ignored_slack_user' THEN subject ->> 'user_id'
            WHEN 'quiz' THEN (SELECT l.title FROM course_lessons l WHERE l.id = (subject ->> 'lesson_id'))
        END,
        NULLIF(subject ->> 'title', ''), NULLIF(subject ->> 'name', ''),
        NULLIF(subject ->> 'alias', ''), NULLIF(subject ->> 'award_name', '')), 120);
$function$;

------------------------------------------------------------------------------------------------
-- Editing questions: all-or-nothing functions that run as the signed-in admin (SECURITY INVOKER), so the
-- policies above decide what they may touch and the audit log names them.
------------------------------------------------------------------------------------------------

-- Saves one question with all its options (a new one when p_question_id is null), returning its id.
-- p_options is an array of {"id": <existing option id or absent>, "label": text, "is_correct": boolean}, in order.
-- Options not listed are removed; ones listed with an id keep it (so past answers still point at them).
-- Errors: invalid_question (the shape is wrong), not_found (no such quiz or question, or not one the caller may edit).
CREATE FUNCTION public.save_quiz_question(p_quiz_id text, p_question_id text, p_prompt text, p_allows_multiple boolean, p_options jsonb)
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
BEGIN
  IF p_prompt IS NULL OR length(btrim(p_prompt)) = 0 OR length(btrim(p_prompt)) > 1000
     OR p_allows_multiple IS NULL OR p_options IS NULL OR jsonb_typeof(p_options) <> 'array' THEN
    RAISE EXCEPTION 'invalid_question';
  END IF;
  v_count := jsonb_array_length(p_options);
  IF v_count < 2 OR v_count > 12 THEN
    RAISE EXCEPTION 'invalid_question';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_options) o
              WHERE jsonb_typeof(o -> 'label') IS DISTINCT FROM 'string'
                 OR length(btrim(o ->> 'label')) = 0 OR length(btrim(o ->> 'label')) > 500
                 OR jsonb_typeof(o -> 'is_correct') IS DISTINCT FROM 'boolean') THEN
    RAISE EXCEPTION 'invalid_question';
  END IF;
  SELECT count(*) INTO v_correct FROM jsonb_array_elements(p_options) o WHERE (o ->> 'is_correct')::boolean;
  IF v_correct < 1 OR (NOT p_allows_multiple AND v_correct <> 1) THEN
    RAISE EXCEPTION 'invalid_question';
  END IF;

  -- The quiz must be visible (an admin) and a Hub-owned one: row-level security hides the rest.
  IF NOT EXISTS (SELECT 1 FROM quizzes WHERE id = p_quiz_id) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_qid IS NULL THEN
    INSERT INTO quiz_questions (quiz_id, position, prompt, allows_multiple)
    VALUES (p_quiz_id, (SELECT coalesce(max(position), 0) + 1 FROM quiz_questions WHERE quiz_id = p_quiz_id), btrim(p_prompt), p_allows_multiple)
    RETURNING id INTO v_qid;
  ELSE
    UPDATE quiz_questions SET prompt = btrim(p_prompt), allows_multiple = p_allows_multiple
      WHERE id = v_qid AND quiz_id = p_quiz_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found';
    END IF;
    DELETE FROM quiz_options WHERE question_id = v_qid
      AND id NOT IN (SELECT o ->> 'id' FROM jsonb_array_elements(p_options) o WHERE o ->> 'id' IS NOT NULL);
  END IF;

  v_ord := 0;
  FOR v_opt IN SELECT * FROM jsonb_array_elements(p_options) LOOP
    v_ord := v_ord + 1;
    v_oid := v_opt ->> 'id';
    IF v_oid IS NOT NULL THEN
      UPDATE quiz_options SET position = v_ord, label = btrim(v_opt ->> 'label'), is_correct = (v_opt ->> 'is_correct')::boolean
        WHERE id = v_oid AND question_id = v_qid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_question';
      END IF;
    ELSE
      INSERT INTO quiz_options (question_id, position, label, is_correct)
      VALUES (v_qid, v_ord, btrim(v_opt ->> 'label'), (v_opt ->> 'is_correct')::boolean);
    END IF;
  END LOOP;

  UPDATE quizzes SET revision = revision + 1 WHERE id = p_quiz_id;
  RETURN v_qid;
END $$;

-- Removes a question (with its options and any recorded answers to it; attempts keep their scores).
CREATE FUNCTION public.delete_quiz_question(p_quiz_id text, p_question_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
BEGIN
  DELETE FROM quiz_questions WHERE id = p_question_id AND quiz_id = p_quiz_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  UPDATE quiz_questions q SET position = o.ord
    FROM (SELECT id, row_number() OVER (ORDER BY position, id) AS ord FROM quiz_questions WHERE quiz_id = p_quiz_id) o
    WHERE q.id = o.id AND q.position <> o.ord;
  UPDATE quizzes SET revision = revision + 1 WHERE id = p_quiz_id;
END $$;

-- Puts the quiz's questions in the given order. The list must be exactly the current questions, so a stale
-- screen can't drop or resurrect one (stale_order).
CREATE FUNCTION public.reorder_quiz_questions(p_quiz_id text, p_ids text[])
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  current_ids text[];
  updated integer;
BEGIN
  IF cardinality(p_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_ids) AS x) THEN
    RAISE EXCEPTION 'stale_order';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM quizzes WHERE id = p_quiz_id) THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO current_ids FROM quiz_questions WHERE quiz_id = p_quiz_id;
  IF current_ids IS DISTINCT FROM (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(p_ids) AS x) THEN
    RAISE EXCEPTION 'stale_order';
  END IF;
  -- Already in this order: nothing to write and no audit entry.
  IF (SELECT array_agg(id ORDER BY position, id) FROM quiz_questions WHERE quiz_id = p_quiz_id) = p_ids THEN
    RETURN;
  END IF;
  UPDATE quiz_questions q SET position = o.ord
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
    WHERE q.id = o.id AND q.quiz_id = p_quiz_id;
  GET DIAGNOSTICS updated = ROW_COUNT;
  -- Row-level security hides rows the caller may not edit (an imported quiz's): fewer rows moved than asked.
  IF updated <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  UPDATE quizzes SET revision = revision + 1 WHERE id = p_quiz_id;
END $$;

REVOKE ALL ON FUNCTION public.save_quiz_question(text, text, text, boolean, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_quiz_question(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reorder_quiz_questions(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_quiz_question(text, text, text, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_quiz_question(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_quiz_questions(text, text[]) TO authenticated;

------------------------------------------------------------------------------------------------
-- A quiz lesson is completed by passing, not by a click: a member's own client can't set `completed_at` on one.
-- The server (service role, or a definer function) writes it after scoring an attempt.
------------------------------------------------------------------------------------------------

CREATE FUNCTION public.quiz_lesson_completion_guard() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.completed_at IS DISTINCT FROM NEW.completed_at)
     AND current_user IN ('authenticated', 'anon')
     AND EXISTS (SELECT 1 FROM public.quizzes WHERE lesson_id = NEW.lesson_id) THEN
    RAISE EXCEPTION 'A quiz lesson is completed by passing its quiz' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER quiz_lesson_completion
  BEFORE INSERT OR UPDATE OF completed_at ON public.lesson_progress
  FOR EACH ROW WHEN (NEW.completed_at IS NOT NULL)
  EXECUTE FUNCTION public.quiz_lesson_completion_guard();

NOTIFY pgrst, 'reload schema';

-- What a removal request does to a member's attempts (supabase/tests/database/member_data_handling.test.sql fails a
-- member-owned table without a row): the score still counts for the quiz's results, and with the member re-pointed
-- at the former-member placeholder nothing in the row says who it was.
INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('quiz_attempts', 'member_id', 'repoint', 'the score counts for the quiz''s results; nothing in the row identifies the member once it is re-pointed');
