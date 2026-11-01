-- Course editor, part 2: admins add, rename, delete, duplicate and reorder the modules and lessons of
-- Hub-owned courses (`source = 'hub'`), with their own client, so each change is written as them in the
-- audit log (see 20270315000000 for the same rules on `courses`). A course imported from Kajabi stays
-- read only: the policies below never match one of its modules or lessons, whoever asks.

------------------------------------------------------------------------------------------------
-- Structure the database now enforces (production checked 2026-10-31: no row breaks any of it)
------------------------------------------------------------------------------------------------

-- A module's parent and a lesson's module belong to the same course. (The foreign keys on the single
-- columns stay; these add the course to the match, so a row can't point into another course.)
ALTER TABLE public.course_modules ADD CONSTRAINT course_modules_id_course_id_key UNIQUE (id, course_id);
ALTER TABLE public.course_modules
  ADD CONSTRAINT course_modules_parent_same_course
  FOREIGN KEY (parent_id, course_id) REFERENCES public.course_modules (id, course_id) ON DELETE CASCADE;
ALTER TABLE public.course_lessons
  ADD CONSTRAINT course_lessons_module_same_course
  FOREIGN KEY (module_id, course_id) REFERENCES public.course_modules (id, course_id) ON DELETE CASCADE;
ALTER TABLE public.course_modules ADD CONSTRAINT course_modules_not_own_parent CHECK (parent_id IS DISTINCT FROM id);

-- A Hub-owned module nests one level at most: a module has submodules, a submodule has lessons only.
CREATE FUNCTION public.course_module_depth_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM course_modules p WHERE p.id = NEW.parent_id AND p.parent_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A submodule can''t have submodules' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM course_modules c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'A module that has submodules can''t become a submodule' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER course_module_depth
  BEFORE INSERT OR UPDATE OF parent_id ON public.course_modules
  FOR EACH ROW WHEN (NEW.source = 'hub' AND NEW.parent_id IS NOT NULL)
  EXECUTE FUNCTION public.course_module_depth_guard();

------------------------------------------------------------------------------------------------
-- Who may write: admins, Hub-owned rows of Hub-owned courses
------------------------------------------------------------------------------------------------

GRANT INSERT, UPDATE, DELETE ON public.course_modules, public.course_lessons TO authenticated;

CREATE POLICY "Admins create hub modules" ON public.course_modules
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()) AND source = 'hub'
    AND EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_id AND c.source = 'hub'));
CREATE POLICY "Admins edit hub modules" ON public.course_modules
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()) AND source = 'hub')
  WITH CHECK ((SELECT public.is_admin()) AND source = 'hub'
    AND EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_id AND c.source = 'hub'));
CREATE POLICY "Admins delete hub modules" ON public.course_modules
  FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()) AND source = 'hub');

CREATE POLICY "Admins create hub lessons" ON public.course_lessons
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()) AND source = 'hub'
    AND EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_id AND c.source = 'hub'));
CREATE POLICY "Admins edit hub lessons" ON public.course_lessons
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()) AND source = 'hub')
  WITH CHECK ((SELECT public.is_admin()) AND source = 'hub'
    AND EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_id AND c.source = 'hub'));
CREATE POLICY "Admins delete hub lessons" ON public.course_lessons
  FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()) AND source = 'hub');

------------------------------------------------------------------------------------------------
-- Audit: Hub-owned rows only (the Kajabi sync rewrites imported rows every run), and not a change of
-- position alone: reordering a list rewrites every row in it, and one row per row would bury the rest.
------------------------------------------------------------------------------------------------

CREATE TRIGGER audit_row_change_hub
  AFTER INSERT ON public.course_modules
  FOR EACH ROW WHEN (NEW.source = 'hub')
  EXECUTE FUNCTION audit_row_change('course_module', 'id');
CREATE TRIGGER audit_row_change_hub_update
  AFTER UPDATE ON public.course_modules
  FOR EACH ROW WHEN (NEW.source = 'hub' AND (to_jsonb(OLD) - 'position' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'position' - 'updated_at'))
  EXECUTE FUNCTION audit_row_change('course_module', 'id');
CREATE TRIGGER audit_row_change_hub_delete
  AFTER DELETE ON public.course_modules
  FOR EACH ROW WHEN (OLD.source = 'hub')
  EXECUTE FUNCTION audit_row_change('course_module', 'id');

CREATE TRIGGER audit_row_change_hub
  AFTER INSERT ON public.course_lessons
  FOR EACH ROW WHEN (NEW.source = 'hub')
  EXECUTE FUNCTION audit_row_change('course_lesson', 'id');
CREATE TRIGGER audit_row_change_hub_update
  AFTER UPDATE ON public.course_lessons
  FOR EACH ROW WHEN (NEW.source = 'hub' AND (to_jsonb(OLD) - 'position' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'position' - 'updated_at'))
  EXECUTE FUNCTION audit_row_change('course_lesson', 'id');
CREATE TRIGGER audit_row_change_hub_delete
  AFTER DELETE ON public.course_lessons
  FOR EACH ROW WHEN (OLD.source = 'hub')
  EXECUTE FUNCTION audit_row_change('course_lesson', 'id');

------------------------------------------------------------------------------------------------
-- Operations that must be all-or-nothing. SECURITY INVOKER: they run as the signed-in admin, so the
-- policies above decide what they may touch and the audit log names them.
------------------------------------------------------------------------------------------------

-- Puts the children of one parent in the given order (a course's top-level modules, a module's
-- submodules, or a module's lessons; p_parent_id NULL for the top level or for lessons in no module).
-- The list must be exactly the current children, so a stale screen can't drop or resurrect one.
CREATE FUNCTION public.reorder_course_children(p_course_id text, p_kind text, p_parent_id text, p_ids text[])
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  current_ids text[];
  updated integer;
BEGIN
  IF p_kind NOT IN ('module', 'lesson') THEN
    RAISE EXCEPTION 'unknown_kind';
  END IF;
  IF cardinality(p_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_ids) AS x) THEN
    RAISE EXCEPTION 'stale_order';
  END IF;

  IF p_kind = 'module' THEN
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO current_ids
      FROM course_modules WHERE course_id = p_course_id AND parent_id IS NOT DISTINCT FROM p_parent_id;
  ELSE
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO current_ids
      FROM course_lessons WHERE course_id = p_course_id AND module_id IS NOT DISTINCT FROM p_parent_id;
  END IF;
  IF current_ids IS DISTINCT FROM (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(p_ids) AS x) THEN
    RAISE EXCEPTION 'stale_order';
  END IF;

  IF p_kind = 'module' THEN
    UPDATE course_modules m SET position = o.ord
      FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
      WHERE m.id = o.id AND m.course_id = p_course_id;
  ELSE
    UPDATE course_lessons l SET position = o.ord
      FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
      WHERE l.id = o.id AND l.course_id = p_course_id;
  END IF;
  GET DIAGNOSTICS updated = ROW_COUNT;
  -- Row-level security hides rows the caller may not edit (an imported course's): fewer rows moved than asked.
  IF updated <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
END $$;

-- A copy of a lesson, at the end of the same module, as a draft. Copies the text, thumbnail and video
-- link (the same video, not a second upload); a lesson's downloads aren't copied yet.
CREATE FUNCTION public.duplicate_course_lesson(p_lesson_id text)
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
  INSERT INTO course_lessons (course_id, module_id, title, position, state, body_html, excerpt, thumbnail_url, thumbnail_source, thumbnail_asset_id, video_id, duration_seconds, source)
  VALUES (
    src.course_id, src.module_id, left(src.title, 112) || ' (copy)',
    (SELECT coalesce(max(position), 0) + 1 FROM course_lessons WHERE course_id = src.course_id AND module_id IS NOT DISTINCT FROM src.module_id),
    'hidden', src.body_html, src.excerpt, src.thumbnail_url, src.thumbnail_source, src.thumbnail_asset_id, src.video_id, src.duration_seconds, 'hub'
  ) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

-- A copy of a module (or submodule) at the end of its siblings, as a draft, with its submodules and
-- every lesson in them (copied as above).
CREATE FUNCTION public.duplicate_course_module(p_module_id text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  src course_modules%ROWTYPE;
  child course_modules%ROWTYPE;
  new_id text;
  new_child_id text;
BEGIN
  SELECT * INTO src FROM course_modules WHERE id = p_module_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  INSERT INTO course_modules (course_id, parent_id, title, position, state, poster_url, poster_source, poster_asset_id, source)
  VALUES (
    src.course_id, src.parent_id, left(src.title, 112) || ' (copy)',
    (SELECT coalesce(max(position), 0) + 1 FROM course_modules WHERE course_id = src.course_id AND parent_id IS NOT DISTINCT FROM src.parent_id),
    'hidden', src.poster_url, src.poster_source, src.poster_asset_id, 'hub'
  ) RETURNING id INTO new_id;

  INSERT INTO course_lessons (course_id, module_id, title, position, state, body_html, excerpt, thumbnail_url, thumbnail_source, thumbnail_asset_id, video_id, duration_seconds, source)
  SELECT l.course_id, new_id, l.title, l.position, 'hidden', l.body_html, l.excerpt, l.thumbnail_url, l.thumbnail_source, l.thumbnail_asset_id, l.video_id, l.duration_seconds, 'hub'
    FROM course_lessons l WHERE l.module_id = p_module_id;

  FOR child IN SELECT * FROM course_modules WHERE parent_id = p_module_id ORDER BY position LOOP
    INSERT INTO course_modules (course_id, parent_id, title, position, state, poster_url, poster_source, poster_asset_id, source)
    VALUES (child.course_id, new_id, child.title, child.position, 'hidden', child.poster_url, child.poster_source, child.poster_asset_id, 'hub')
    RETURNING id INTO new_child_id;
    INSERT INTO course_lessons (course_id, module_id, title, position, state, body_html, excerpt, thumbnail_url, thumbnail_source, thumbnail_asset_id, video_id, duration_seconds, source)
    SELECT l.course_id, new_child_id, l.title, l.position, 'hidden', l.body_html, l.excerpt, l.thumbnail_url, l.thumbnail_source, l.thumbnail_asset_id, l.video_id, l.duration_seconds, 'hub'
      FROM course_lessons l WHERE l.module_id = child.id;
  END LOOP;
  RETURN new_id;
END $$;

REVOKE ALL ON FUNCTION public.reorder_course_children(text, text, text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duplicate_course_lesson(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duplicate_course_module(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_course_children(text, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_course_lesson(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_course_module(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
