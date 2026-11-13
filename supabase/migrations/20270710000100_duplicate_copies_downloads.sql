-- Duplicating a lesson or a module copies the lessons' downloads too (they were left out: the copy had the text and
-- the video but not the files). A copy's download is a row of its own with a key of its own ("up-<uuid>", like a
-- download added in the Hub; the original's key is Kajabi's file id or its own upload key, and must stay unique) that
-- points at the same stored object, so nothing is copied in storage. Removing a download therefore checks first that
-- no other row uses the object (`storagePathShared` in lib/data/courses.ts, called by the lesson file actions and the
-- Kajabi file copy step).
--
-- Replaces the functions of 20270401000000 (their latest definition) and adds the helper they share. Writing a
-- download is for the service role only (no policy lets a signed-in user), so the helper is SECURITY DEFINER and
-- checks for itself that the caller is an admin and that the target is a Hub-owned lesson.

set lock_timeout = '5s';

-- Copies the downloads of one lesson onto another, as rows pointing at the same stored object. Returns how many.
CREATE FUNCTION public.copy_course_lesson_files(p_from_lesson text, p_to_lesson text) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM course_lessons WHERE id = p_to_lesson AND source = 'hub') THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  INSERT INTO course_lesson_files (lesson_id, source_key, filename, content_type, size_bytes, content_hash, storage_path, position)
  SELECT p_to_lesson, 'up-' || gen_random_uuid(), f.filename, f.content_type, f.size_bytes, f.content_hash, f.storage_path, f.position
    FROM course_lesson_files f WHERE f.lesson_id = p_from_lesson;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.copy_course_lesson_files(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_course_lesson_files(text, text) TO authenticated;

COMMENT ON FUNCTION public.copy_course_lesson_files(text, text) IS
  'Copies a lesson''s downloads onto another (Hub-owned) lesson: new rows with their own keys, the same stored object. Used by the duplicate functions.';

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
    END LOOP;
  END LOOP;
  RETURN new_id;
END $$;

NOTIFY pgrst, 'reload schema';
