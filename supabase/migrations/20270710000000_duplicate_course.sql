-- Duplicate a course: a new Hub-owned course (`source = 'hub'`, no Kajabi key) with a copy of the whole tree
-- (modules, submodules, lessons with their text, images and the link to the same video), so admins can try the
-- editor on a copy while the real course stays linked to Kajabi and keeps syncing. Works on an imported course and
-- on a Hub-owned one.
--
-- What the copy is: a draft course (`is_draft`, so members can't see it and no access is built for it), every module
-- and lesson a draft, no program (publishing it later must not hand it to everyone who bought the program: an admin
-- links it on purpose), no Kajabi key (the Kajabi import never touches it). What it does not carry: members' progress,
-- access and grants, watch segments, and the Kajabi link and offers. The lesson downloads are copied as rows pointing
-- at the same stored object, with a key of their own ("up-<uuid>", like a download added in the Hub); the app removes
-- an object only when no other row uses it (`storagePathShared`, lib/data/courses.ts).

set lock_timeout = '5s';

-- The audit log records the intent once: the new course's entry (who, from which course, how many modules and
-- lessons). Without this, every copied module and lesson would write an insert entry of its own. A copy sets
-- `app.audit_skip_course` to the new course's id for its own transaction, and the insert triggers of that course's
-- rows stay quiet. (Replaces the insert triggers of 20270317000000.)
DROP TRIGGER audit_row_change_hub ON public.course_modules;
CREATE TRIGGER audit_row_change_hub
  AFTER INSERT ON public.course_modules
  FOR EACH ROW WHEN (NEW.source = 'hub' AND current_setting('app.audit_skip_course', true) IS DISTINCT FROM NEW.course_id)
  EXECUTE FUNCTION audit_row_change('course_module', 'id');
DROP TRIGGER audit_row_change_hub ON public.course_lessons;
CREATE TRIGGER audit_row_change_hub
  AFTER INSERT ON public.course_lessons
  FOR EACH ROW WHEN (NEW.source = 'hub' AND current_setting('app.audit_skip_course', true) IS DISTINCT FROM NEW.course_id)
  EXECUTE FUNCTION audit_row_change('course_lesson', 'id');

-- Admin or the service role; returns the new course's id. An unknown course is `not_found`; one whose modules nest
-- deeper than the editor does (a module has submodules, a submodule has lessons only) is `too_deep`, as for a take-over.
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
  v_map jsonb;
  v_lmap jsonb;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
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

  -- A free address: "<slug>-copy", then "-copy-2", "-copy-3"... (the base is cut so the address stays short).
  v_base := left(src.slug, 60) || '-copy';
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM courses WHERE slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  v_new := public.new_id('crs');
  PERFORM set_config('app.audit_skip_course', v_new, true);

  INSERT INTO courses (id, slug, title, description, source, source_key, kind, program_id, access_duration, launch_at, is_draft,
                       thumbnail_url, thumbnail_source, thumbnail_asset_id, hero_url, hero_source, hero_asset_id)
  VALUES (v_new, v_slug, left(src.title, 112) || ' (copy)', src.description, 'hub', NULL, src.kind, NULL, src.access_duration, src.launch_at, true,
          src.thumbnail_url, src.thumbnail_source, src.thumbnail_asset_id, src.hero_url, src.hero_source, src.hero_asset_id);

  -- Modules: new ids, mapped from the old ones (old id -> new id). Top-level first, then submodules (the depth guard looks at the
  -- parent, which has to exist by then).
  SELECT coalesce(jsonb_object_agg(id, public.new_id('mod')), '{}'::jsonb) INTO v_map FROM course_modules WHERE course_id = p_course_id;

  INSERT INTO course_modules (id, course_id, parent_id, title, position, state, publishing_option, poster_url, poster_source, poster_asset_id, source)
  SELECT v_map ->> o.id, v_new, NULL, o.title, o.position, 'hidden', 'draft', o.poster_url, o.poster_source, o.poster_asset_id, 'hub'
    FROM course_modules o
   WHERE o.course_id = p_course_id AND o.parent_id IS NULL;
  INSERT INTO course_modules (id, course_id, parent_id, title, position, state, publishing_option, poster_url, poster_source, poster_asset_id, source)
  SELECT v_map ->> o.id, v_new, v_map ->> o.parent_id, o.title, o.position, 'hidden', 'draft', o.poster_url, o.poster_source, o.poster_asset_id, 'hub'
    FROM course_modules o
   WHERE o.course_id = p_course_id AND o.parent_id IS NOT NULL;

  -- Lessons (also those in no module): same text, images and video, no downloads.
  SELECT coalesce(jsonb_object_agg(id, public.new_id('les')), '{}'::jsonb) INTO v_lmap FROM course_lessons WHERE course_id = p_course_id;
  INSERT INTO course_lessons (id, course_id, module_id, title, position, state, publishing_option, body_html, excerpt, thumbnail_url, thumbnail_source, thumbnail_asset_id, video_id, duration_seconds, source)
  SELECT v_lmap ->> l.id, v_new, v_map ->> l.module_id, l.title, l.position, 'hidden', 'draft', l.body_html, l.excerpt, l.thumbnail_url, l.thumbnail_source, l.thumbnail_asset_id, l.video_id, l.duration_seconds, 'hub'
    FROM course_lessons l
   WHERE l.course_id = p_course_id;

  -- Downloads: a row of its own per copied lesson, the same stored object.
  INSERT INTO course_lesson_files (lesson_id, source_key, filename, content_type, size_bytes, content_hash, storage_path, position)
  SELECT v_lmap ->> f.lesson_id, 'up-' || gen_random_uuid(), f.filename, f.content_type, f.size_bytes, f.content_hash, f.storage_path, f.position
    FROM course_lesson_files f
   WHERE f.lesson_id IN (SELECT id FROM course_lessons WHERE course_id = p_course_id);
  GET DIAGNOSTICS v_files = ROW_COUNT;

  SELECT count(*) INTO v_modules FROM course_modules WHERE course_id = v_new;
  SELECT count(*) INTO v_lessons FROM course_lessons WHERE course_id = v_new;

  -- The course's own insert entry says where it came from and what it holds.
  UPDATE audit_log
     SET changes = changes || jsonb_build_object(
           'copied_from', jsonb_build_object('old', NULL, 'new', p_course_id),
           'modules_copied', jsonb_build_object('old', NULL, 'new', v_modules),
           'lessons_copied', jsonb_build_object('old', NULL, 'new', v_lessons),
           'files_copied', jsonb_build_object('old', NULL, 'new', v_files))
   WHERE txid = txid_current() AND entity_type = 'course' AND entity_id = v_new AND action = 'insert';

  PERFORM set_config('app.audit_skip_course', '', true);
  RETURN v_new;
END $$;

REVOKE ALL ON FUNCTION public.duplicate_course(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_course(text) TO authenticated;

COMMENT ON FUNCTION public.duplicate_course(text) IS
  'Copies a course (imported or Hub-owned) into a new draft Hub-owned course with draft modules and lessons, sharing videos, images and the stored downloads; no progress, access or Kajabi link. One audit entry, for the new course.';

NOTIFY pgrst, 'reload schema';
