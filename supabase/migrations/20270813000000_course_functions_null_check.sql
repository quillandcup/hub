-- Course functions: close the NULL hole in the caller check (as 20270810000000 did for reorder_course_children).
--
-- Each of these checked `IF NOT (public.is_admin() OR auth.role() = 'service_role')`. For a caller whose claims
-- carry no role, auth.role() is NULL, so `false OR NULL` is NULL, `NOT NULL` is NULL, and the IF did not raise:
-- the caller passed. Each test is now coalesced to false, as reorder_writing_projects (20270808000000) does.
--
-- Each function is its latest definition, re-stated with only that guard changed: same signature, same
-- SECURITY DEFINER, same search_path, same grants. Who may call each (an admin, or the server itself, the service
-- role) is unchanged.
--   move_course_lesson            (20270420000000)
--   take_over_kajabi_course       (20270415000000)
--   copy_course_lesson_files      (20270710000100)
--   duplicate_course              (20270712000000)
--   set_course_item_status        (20270403000000)
--   moderate_lesson_comment       (20270803000000)

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.move_course_lesson(p_lesson_id text, p_module_id text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_course text;
  v_source text;
  v_old text;
BEGIN
  IF NOT (coalesce(public.is_admin(), false) OR coalesce(auth.role() = 'service_role', false)) THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  SELECT course_id, source, module_id INTO v_course, v_source, v_old FROM course_lessons WHERE id = p_lesson_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_source <> 'hub' OR NOT EXISTS (SELECT 1 FROM courses WHERE id = v_course AND source = 'hub') THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  IF v_old IS NOT DISTINCT FROM p_module_id THEN
    RETURN;
  END IF;
  IF p_module_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM course_modules WHERE id = p_module_id AND course_id = v_course) THEN
    RAISE EXCEPTION 'module_not_found';
  END IF;

  -- The end of the list it joins. (The list it leaves keeps its numbers: they only order, and the next reorder renumbers.)
  UPDATE course_lessons
     SET module_id = p_module_id,
         position = coalesce((SELECT max(position) FROM course_lessons WHERE course_id = v_course AND module_id IS NOT DISTINCT FROM p_module_id), 0) + 1
   WHERE id = p_lesson_id;
  PERFORM public.recompute_course_states(v_course);
END $$;

REVOKE ALL ON FUNCTION public.move_course_lesson(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_course_lesson(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.take_over_kajabi_course(p_course_id text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_source text;
BEGIN
  IF NOT (coalesce(public.is_admin(), false) OR coalesce(auth.role() = 'service_role', false)) THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  SELECT source INTO v_source FROM courses WHERE id = p_course_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_source <> 'kajabi' THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM course_modules c
      JOIN course_modules p ON p.id = c.parent_id AND p.course_id = c.course_id
     WHERE c.course_id = p_course_id AND p.parent_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'too_deep';
  END IF;

  -- A Hub-owned row has a setting the editor knows. Kajabi's rows can have none, or one it doesn't use: those
  -- are hidden from members already (no setting is hidden), which is what a draft is.
  UPDATE course_modules SET publishing_option = 'draft'
   WHERE course_id = p_course_id AND (publishing_option IS NULL OR publishing_option <> ALL (ARRAY['draft', 'published', 'scheduled', 'drip', 'locked']));
  UPDATE course_lessons SET publishing_option = 'draft'
   WHERE course_id = p_course_id AND (publishing_option IS NULL OR publishing_option <> ALL (ARRAY['draft', 'published', 'scheduled', 'drip', 'locked']));

  UPDATE course_modules SET source = 'hub' WHERE course_id = p_course_id;
  UPDATE course_lessons SET source = 'hub' WHERE course_id = p_course_id;
  UPDATE courses SET source = 'hub' WHERE id = p_course_id;

  -- The states Kajabi's import worked out came from the same rule, so nothing moves; this makes sure.
  PERFORM public.recompute_course_states(p_course_id);
END $$;

REVOKE ALL ON FUNCTION public.take_over_kajabi_course(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.take_over_kajabi_course(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.copy_course_lesson_files(p_from_lesson text, p_to_lesson text) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT (coalesce(public.is_admin(), false) OR coalesce(auth.role() = 'service_role', false)) THEN
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

  SELECT count(*) INTO v_modules FROM course_modules WHERE course_id = v_new;
  SELECT count(*) INTO v_lessons FROM course_lessons WHERE course_id = v_new;

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

CREATE OR REPLACE FUNCTION public.set_course_item_status(p_kind text, p_id text, p_option text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_course text;
  v_old text;
  v_source text;
BEGIN
  IF NOT (coalesce(public.is_admin(), false) OR coalesce(auth.role() = 'service_role', false)) THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  IF p_kind NOT IN ('module', 'lesson') THEN
    RAISE EXCEPTION 'unknown_kind';
  END IF;
  IF p_option NOT IN ('draft', 'published', 'locked') THEN
    RAISE EXCEPTION 'unsupported_status';
  END IF;

  IF p_kind = 'module' THEN
    SELECT course_id, publishing_option, source INTO v_course, v_old, v_source FROM course_modules WHERE id = p_id;
  ELSE
    SELECT course_id, publishing_option, source INTO v_course, v_old, v_source FROM course_lessons WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_source <> 'hub' OR NOT EXISTS (SELECT 1 FROM courses WHERE id = v_course AND source = 'hub') THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  IF v_old IS NOT DISTINCT FROM p_option THEN
    RETURN;
  END IF;

  IF p_kind = 'module' THEN
    UPDATE course_modules SET publishing_option = p_option WHERE id = p_id;
  ELSE
    UPDATE course_lessons SET publishing_option = p_option WHERE id = p_id;
  END IF;
  PERFORM public.recompute_course_states(v_course);
END $$;

REVOKE ALL ON FUNCTION public.set_course_item_status(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_course_item_status(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.moderate_lesson_comment(p_comment_id text, p_action text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c public.lesson_comments;
  v_actor text;
  v_old text;
  v_new text;
  v_open integer := 0;
  v_changes jsonb := '{}'::jsonb;
  v_label text;
  v_handled boolean := false;
BEGIN
  IF NOT (coalesce(public.is_admin(), false) OR coalesce(auth.role() = 'service_role', false)) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('hide', 'unhide', 'delete', 'approve', 'handle', 'dismiss') THEN
    RAISE EXCEPTION 'unknown_action';
  END IF;

  SELECT * INTO c FROM public.lesson_comments WHERE id = p_comment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  v_actor := public.current_member_id();
  v_old := CASE WHEN c.deleted_at IS NOT NULL THEN 'deleted' WHEN c.hidden_at IS NOT NULL THEN 'hidden' WHEN c.held_at IS NOT NULL THEN 'held' ELSE 'visible' END;

  IF p_action = 'hide' THEN
    IF c.deleted_at IS NOT NULL OR c.hidden_at IS NOT NULL THEN RETURN 'no_change'; END IF;
    UPDATE public.lesson_comments SET hidden_at = now() WHERE id = c.id;
  ELSIF p_action = 'unhide' THEN
    IF c.deleted_at IS NOT NULL OR c.hidden_at IS NULL THEN RETURN 'no_change'; END IF;
    UPDATE public.lesson_comments SET hidden_at = NULL WHERE id = c.id;
  ELSIF p_action = 'delete' THEN
    IF c.deleted_at IS NOT NULL THEN RETURN 'no_change'; END IF;
    UPDATE public.lesson_comments SET deleted_at = now(), deleted_by = v_actor WHERE id = c.id;
  ELSIF p_action = 'approve' THEN
    IF c.deleted_at IS NOT NULL OR c.held_at IS NULL THEN RETURN 'no_change'; END IF;
    UPDATE public.lesson_comments SET held_at = NULL, held_reason = NULL WHERE id = c.id;
  ELSIF p_action = 'handle' THEN
    IF c.parent_id IS NOT NULL OR c.deleted_at IS NOT NULL OR c.handled_at IS NOT NULL THEN RETURN 'no_change'; END IF;
    UPDATE public.lesson_comments SET handled_at = now(), handled_by = v_actor WHERE id = c.id;
    v_handled := true;
  END IF;

  -- Hiding or deleting settles what was reported; dismissing settles it without touching the comment.
  IF p_action IN ('hide', 'delete', 'dismiss') THEN
    WITH settled AS (
      UPDATE public.lesson_comment_reports SET resolved_at = now(), resolved_by = v_actor
      WHERE comment_id = c.id AND resolved_at IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO v_open FROM settled;
    IF p_action = 'dismiss' AND v_open = 0 THEN RETURN 'no_change'; END IF;
  END IF;

  SELECT CASE WHEN x.deleted_at IS NOT NULL THEN 'deleted' WHEN x.hidden_at IS NOT NULL THEN 'hidden' WHEN x.held_at IS NOT NULL THEN 'held' ELSE 'visible' END
    INTO v_new FROM public.lesson_comments x WHERE x.id = c.id;
  IF v_new IS DISTINCT FROM v_old THEN
    v_changes := v_changes || jsonb_build_object('visibility', jsonb_build_object('old', v_old, 'new', v_new));
  END IF;
  IF v_handled THEN
    v_changes := v_changes || jsonb_build_object('handled', jsonb_build_object('old', false, 'new', true));
  END IF;
  IF v_open > 0 THEN
    v_changes := v_changes || jsonb_build_object('reports_resolved', jsonb_build_object('old', v_open, 'new', 0));
  END IF;

  SELECT l.title INTO v_label FROM public.course_lessons l WHERE l.id = c.lesson_id;
  INSERT INTO public.audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, entity_label)
  VALUES (
    auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'staff' END, public.current_acting_as_member_id(),
    'lesson_comment', c.id, 'update', v_changes, v_label
  );
  RETURN 'done';
END;
$function$;

REVOKE ALL ON FUNCTION public.moderate_lesson_comment(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_lesson_comment(text, text) TO authenticated, service_role;
