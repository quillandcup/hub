-- Duplicating a lesson, a module or a course copies the quizzes in it too (they were left out, so the builder refused to
-- duplicate anything that held one). A copy of a quiz lesson gets a quiz of its own: the settings (passing grade, hide
-- answers), every question with its options in order, and which options are right. It never gets attempts or answers,
-- and no Kajabi keys (the copy is Hub-owned; a key would collide with the original's on the processing run's upsert).
--
-- Expand only. Replaces the latest definitions of duplicate_course_lesson and duplicate_course_module
-- (20270710000100) and duplicate_course (20270813000000), adds the helper they share, and re-creates the insert audit
-- trigger of quizzes with one more condition.
--
-- Audit: duplicating one lesson or module audits each new lesson as before, and the new quiz gets its own entry like
-- any quiz. Duplicating a whole course is one entry for the course (no per-module, per-lesson entry), so the quizzes
-- in it are not audited one by one either; the course's entry says how many were copied (`quizzes_copied`).

set lock_timeout = '5s';

-- The insert audit of quizzes stays quiet while duplicate_course runs (it sets app.audit_skip_quiz_copy for its own
-- transaction, as it does app.audit_skip_course for modules and lessons).
DROP TRIGGER audit_row_change_insert ON public.quizzes;
CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.quizzes
  FOR EACH ROW WHEN (auth.uid() IS NOT NULL AND current_setting('app.audit_skip_quiz_copy', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION audit_row_change('quiz', 'id');

-- Copies the quiz of one lesson onto another lesson (a Hub-owned one without a quiz): new ids, no source keys, the
-- questions' and options' order and flags kept. Returns the new quiz's id, or null when the source is not a quiz.
-- Runs as the caller, so the policies decide: an admin may write the quiz of a Hub-owned lesson.
CREATE FUNCTION public.copy_lesson_quiz(p_from_lesson text, p_to_lesson text) RETURNS text
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  v_old text;
  v_new text;
  v_map jsonb;
BEGIN
  SELECT id INTO v_old FROM quizzes WHERE lesson_id = p_from_lesson;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Rows are copied whole (jsonb_populate_record over the row, with the columns that must differ overridden), so a column
  -- added to these tables later (a question's kind, say) is carried without this function being edited.
  v_new := public.new_id('quiz');
  INSERT INTO quizzes
  SELECT r.* FROM quizzes q,
    LATERAL jsonb_populate_record(NULL::quizzes, to_jsonb(q) || jsonb_build_object(
      'id', v_new, 'lesson_id', p_to_lesson, 'revision', 0, 'source_key', NULL, 'created_at', now(), 'updated_at', now())) r
   WHERE q.id = v_old;

  SELECT coalesce(jsonb_object_agg(id, public.new_id('qques')), '{}'::jsonb) INTO v_map FROM quiz_questions WHERE quiz_id = v_old;

  INSERT INTO quiz_questions
  SELECT r.* FROM quiz_questions q,
    LATERAL jsonb_populate_record(NULL::quiz_questions, to_jsonb(q) || jsonb_build_object(
      'id', v_map ->> q.id, 'quiz_id', v_new, 'source_key', NULL, 'created_at', now(), 'updated_at', now())) r
   WHERE q.quiz_id = v_old;

  INSERT INTO quiz_options
  SELECT r.* FROM quiz_options o,
    LATERAL jsonb_populate_record(NULL::quiz_options, to_jsonb(o) || jsonb_build_object(
      'id', public.new_id('qopt'), 'question_id', v_map ->> o.question_id, 'source_key', NULL, 'created_at', now(), 'updated_at', now())) r
   WHERE o.question_id IN (SELECT id FROM quiz_questions WHERE quiz_id = v_old);

  RETURN v_new;
END $$;

REVOKE ALL ON FUNCTION public.copy_lesson_quiz(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_lesson_quiz(text, text) TO authenticated;

COMMENT ON FUNCTION public.copy_lesson_quiz(text, text) IS
  'Copies a lesson''s quiz (settings, questions, options, right answers) onto another lesson: new ids, never attempts or answers. Used by the duplicate functions.';

CREATE OR REPLACE FUNCTION public.duplicate_course_lesson(p_lesson_id text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  src course_lessons%ROWTYPE;
  new_id text;
BEGIN
  SELECT * INTO src FROM course_lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  INSERT INTO course_lessons (course_id, module_id, title, position, state, publishing_option, body_html, excerpt, thumbnail_url, thumbnail_source, thumbnail_asset_id, video_id, duration_seconds, source)
  VALUES (
    src.course_id, src.module_id, left(src.title, 112) || ' (copy)',
    (SELECT coalesce(max(position), 0) + 1 FROM course_lessons WHERE course_id = src.course_id AND module_id IS NOT DISTINCT FROM src.module_id),
    'hidden', 'draft', src.body_html, src.excerpt, src.thumbnail_url, src.thumbnail_source, src.thumbnail_asset_id, src.video_id, src.duration_seconds, 'hub'
  ) RETURNING id INTO new_id;
  PERFORM public.copy_course_lesson_files(p_lesson_id, new_id);
  PERFORM public.copy_lesson_quiz(p_lesson_id, new_id);
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.duplicate_course_module(p_module_id text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  src course_modules%ROWTYPE;
  child course_modules%ROWTYPE;
  les course_lessons%ROWTYPE;
  new_id text;
  new_child_id text;
  new_lesson_id text;
BEGIN
  SELECT * INTO src FROM course_modules WHERE id = p_module_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  INSERT INTO course_modules (course_id, parent_id, title, position, state, publishing_option, poster_url, poster_source, poster_asset_id, source)
  VALUES (
    src.course_id, src.parent_id, left(src.title, 112) || ' (copy)',
    (SELECT coalesce(max(position), 0) + 1 FROM course_modules WHERE course_id = src.course_id AND parent_id IS NOT DISTINCT FROM src.parent_id),
    'hidden', 'draft', src.poster_url, src.poster_source, src.poster_asset_id, 'hub'
  ) RETURNING id INTO new_id;

  FOR les IN SELECT * FROM course_lessons WHERE module_id = p_module_id ORDER BY position LOOP
    INSERT INTO course_lessons (course_id, module_id, title, position, state, publishing_option, body_html, excerpt, thumbnail_url, thumbnail_source, thumbnail_asset_id, video_id, duration_seconds, source)
    VALUES (les.course_id, new_id, les.title, les.position, 'hidden', 'draft', les.body_html, les.excerpt, les.thumbnail_url, les.thumbnail_source, les.thumbnail_asset_id, les.video_id, les.duration_seconds, 'hub')
    RETURNING id INTO new_lesson_id;
    PERFORM public.copy_course_lesson_files(les.id, new_lesson_id);
    PERFORM public.copy_lesson_quiz(les.id, new_lesson_id);
  END LOOP;

  FOR child IN SELECT * FROM course_modules WHERE parent_id = p_module_id ORDER BY position LOOP
    INSERT INTO course_modules (course_id, parent_id, title, position, state, publishing_option, poster_url, poster_source, poster_asset_id, source)
    VALUES (child.course_id, new_id, child.title, child.position, 'hidden', 'draft', child.poster_url, child.poster_source, child.poster_asset_id, 'hub')
    RETURNING id INTO new_child_id;
    FOR les IN SELECT * FROM course_lessons WHERE module_id = child.id ORDER BY position LOOP
      INSERT INTO course_lessons (course_id, module_id, title, position, state, publishing_option, body_html, excerpt, thumbnail_url, thumbnail_source, thumbnail_asset_id, video_id, duration_seconds, source)
      VALUES (les.course_id, new_child_id, les.title, les.position, 'hidden', 'draft', les.body_html, les.excerpt, les.thumbnail_url, les.thumbnail_source, les.thumbnail_asset_id, les.video_id, les.duration_seconds, 'hub')
      RETURNING id INTO new_lesson_id;
      PERFORM public.copy_course_lesson_files(les.id, new_lesson_id);
      PERFORM public.copy_lesson_quiz(les.id, new_lesson_id);
    END LOOP;
  END LOOP;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.duplicate_course(p_course_id text) RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  src courses%ROWTYPE;
  v_new text;
  v_slug text;
  v_base text;
  v_n int := 1;
  v_modules int;
  v_lessons int;
  v_files int;
  v_quizzes int := 0;
  v_map jsonb;
  v_lmap jsonb;
  v_quiz_lesson text;
BEGIN
  IF NOT (coalesce(public.is_admin(), false) OR coalesce(auth.role() = 'service_role', false)) THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  SELECT * INTO src FROM courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM course_modules c
      JOIN course_modules p ON p.id = c.parent_id AND p.course_id = c.course_id
     WHERE c.course_id = p_course_id AND p.parent_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'too_deep';
  END IF;

  v_base := left(src.slug, 60) || '-copy';
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM courses WHERE slug = v_slug) OR EXISTS (SELECT 1 FROM course_address_redirects WHERE address = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  v_new := public.new_id('crs');
  PERFORM set_config('app.audit_skip_course', v_new, true);
  PERFORM set_config('app.audit_skip_quiz_copy', 'on', true);

  INSERT INTO courses (id, slug, title, description, source, source_key, kind, program_id, access_duration, launch_at, is_draft,
                       thumbnail_url, thumbnail_source, thumbnail_asset_id, hero_url, hero_source, hero_asset_id)
  VALUES (v_new, v_slug, left(src.title, 112) || ' (copy)', src.description, 'hub', NULL, src.kind, NULL, src.access_duration, src.launch_at, true,
          src.thumbnail_url, src.thumbnail_source, src.thumbnail_asset_id, src.hero_url, src.hero_source, src.hero_asset_id);

  SELECT coalesce(jsonb_object_agg(id, public.new_id('mod')), '{}'::jsonb) INTO v_map FROM course_modules WHERE course_id = p_course_id;

  INSERT INTO course_modules (id, course_id, parent_id, title, position, state, publishing_option, poster_url, poster_source, poster_asset_id, source)
  SELECT v_map ->> o.id, v_new, NULL, o.title, o.position, 'hidden', 'draft', o.poster_url, o.poster_source, o.poster_asset_id, 'hub'
    FROM course_modules o
   WHERE o.course_id = p_course_id AND o.parent_id IS NULL;
  INSERT INTO course_modules (id, course_id, parent_id, title, position, state, publishing_option, poster_url, poster_source, poster_asset_id, source)
  SELECT v_map ->> o.id, v_new, v_map ->> o.parent_id, o.title, o.position, 'hidden', 'draft', o.poster_url, o.poster_source, o.poster_asset_id, 'hub'
    FROM course_modules o
   WHERE o.course_id = p_course_id AND o.parent_id IS NOT NULL;

  SELECT coalesce(jsonb_object_agg(id, public.new_id('les')), '{}'::jsonb) INTO v_lmap FROM course_lessons WHERE course_id = p_course_id;
  INSERT INTO course_lessons (id, course_id, module_id, title, position, state, publishing_option, body_html, excerpt, thumbnail_url, thumbnail_source, thumbnail_asset_id, video_id, duration_seconds, source)
  SELECT v_lmap ->> l.id, v_new, v_map ->> l.module_id, l.title, l.position, 'hidden', 'draft', l.body_html, l.excerpt, l.thumbnail_url, l.thumbnail_source, l.thumbnail_asset_id, l.video_id, l.duration_seconds, 'hub'
    FROM course_lessons l
   WHERE l.course_id = p_course_id;

  INSERT INTO course_lesson_files (lesson_id, source_key, filename, content_type, size_bytes, content_hash, storage_path, position)
  SELECT v_lmap ->> f.lesson_id, 'up-' || gen_random_uuid(), f.filename, f.content_type, f.size_bytes, f.content_hash, f.storage_path, f.position
    FROM course_lesson_files f
   WHERE f.lesson_id IN (SELECT id FROM course_lessons WHERE course_id = p_course_id);
  GET DIAGNOSTICS v_files = ROW_COUNT;

  -- The quizzes: a few per course, so one helper call each.
  FOR v_quiz_lesson IN SELECT q.lesson_id FROM quizzes q JOIN course_lessons l ON l.id = q.lesson_id WHERE l.course_id = p_course_id LOOP
    PERFORM public.copy_lesson_quiz(v_quiz_lesson, v_lmap ->> v_quiz_lesson);
    v_quizzes := v_quizzes + 1;
  END LOOP;

  SELECT count(*) INTO v_modules FROM course_modules WHERE course_id = v_new;
  SELECT count(*) INTO v_lessons FROM course_lessons WHERE course_id = v_new;

  UPDATE audit_log
     SET changes = changes || jsonb_build_object(
           'copied_from', jsonb_build_object('old', NULL, 'new', p_course_id),
           'modules_copied', jsonb_build_object('old', NULL, 'new', v_modules),
           'lessons_copied', jsonb_build_object('old', NULL, 'new', v_lessons),
           'files_copied', jsonb_build_object('old', NULL, 'new', v_files),
           'quizzes_copied', jsonb_build_object('old', NULL, 'new', v_quizzes))
   WHERE txid = txid_current() AND entity_type = 'course' AND entity_id = v_new AND action = 'insert';

  PERFORM set_config('app.audit_skip_course', '', true);
  PERFORM set_config('app.audit_skip_quiz_copy', '', true);
  RETURN v_new;
END $$;

REVOKE ALL ON FUNCTION public.duplicate_course(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_course(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
