-- Course editor, part 3a: a course, its modules and its lessons each store their OWN setting (draft,
-- published, locked, ...), whoever owns the course, and the state members get ('open', 'coming_soon',
-- 'hidden') is worked out from those settings by one rule. Until now the Hub only stored the result, so a
-- Hub-owned item couldn't be told "draft" from "inside a draft module", and an imported course and a
-- Hub-owned one were different models. Now they are the same rows, and the only difference is
-- `courses.source`.
--
-- The setting can be course-wide: the course has one, and a module or lesson can simply FOLLOW what is
-- above it ('inherit', what a new Hub-owned item starts as), so nobody sets rows one by one. An item can
-- still have its own, which is what an imported course has on every row (Kajabi's).
--
-- The rule (lib/courses/visibility.ts is the same rule for the Kajabi sync): an item's own setting gives
-- its visibility (published = open; locked or drip = coming soon; anything else, a draft or no setting,
-- hidden), 'inherit' is whatever is above it, and nothing is more visible than what is above it. For a
-- top-level module or a lesson in no module, "above it" is the course.

------------------------------------------------------------------------------------------------
-- The columns, filled in for what exists
------------------------------------------------------------------------------------------------

ALTER TABLE public.courses ADD COLUMN publishing_option text NOT NULL DEFAULT 'draft';
ALTER TABLE public.course_modules ADD COLUMN publishing_option text DEFAULT 'inherit';
ALTER TABLE public.course_lessons ADD COLUMN publishing_option text DEFAULT 'inherit';

COMMENT ON COLUMN public.courses.publishing_option IS
  'The whole course''s setting: draft, published or locked. Everything in the course is limited by it. For an imported course it follows is_draft (a published import is published); for a Hub-owned one is_draft follows it.';
COMMENT ON COLUMN public.course_modules.publishing_option IS
  'The module''s own setting: inherit (follows the module or course above it), draft, published, scheduled, drip or locked. Its state (what members get) follows from this and what is above it. For an imported course this is whatever Kajabi says, including nothing.';
COMMENT ON COLUMN public.course_lessons.publishing_option IS
  'The lesson''s own setting: inherit (follows its module, or the course), draft, published, scheduled, drip or locked. Its state (what members get) follows from this and what is above it. For an imported course this is whatever Kajabi says, including nothing.';

-- Imported rows: what Kajabi says, from the Bronze copy they were built from.
UPDATE public.course_modules m SET publishing_option = b.publishing_option
  FROM bronze.kajabi_course_modules b WHERE m.source = 'kajabi' AND m.source_key = b.kajabi_id;
UPDATE public.course_lessons l SET publishing_option = b.publishing_option
  FROM bronze.kajabi_course_lessons b WHERE l.source = 'kajabi' AND l.source_key = b.kajabi_id;

-- Hub-owned rows made before this column existed: the state they have, as their own setting.
UPDATE public.course_modules SET publishing_option = CASE state WHEN 'open' THEN 'published' WHEN 'coming_soon' THEN 'locked' ELSE 'draft' END WHERE source = 'hub';
UPDATE public.course_lessons SET publishing_option = CASE state WHEN 'open' THEN 'published' WHEN 'coming_soon' THEN 'locked' ELSE 'draft' END WHERE source = 'hub';

-- Courses: an imported course is published unless it is the draft row the sync makes before publishing;
-- a Hub-owned one made before this column existed is published too (it was open to whoever had access).
UPDATE public.courses SET publishing_option = CASE WHEN is_draft THEN 'draft' ELSE 'published' END;

-- A Hub-owned item always has a setting the editor knows. An imported one is whatever Kajabi sends: a
-- value this list doesn't have must never make the sync fail, so the check is not for those.
ALTER TABLE public.courses ADD CONSTRAINT courses_publishing_option CHECK (publishing_option IN ('draft', 'published', 'locked'));
ALTER TABLE public.course_modules ADD CONSTRAINT course_modules_hub_publishing_option
  CHECK (source <> 'hub' OR coalesce(publishing_option IN ('inherit', 'draft', 'published', 'scheduled', 'drip', 'locked'), false));
ALTER TABLE public.course_lessons ADD CONSTRAINT course_lessons_hub_publishing_option
  CHECK (source <> 'hub' OR coalesce(publishing_option IN ('inherit', 'draft', 'published', 'scheduled', 'drip', 'locked'), false));

-- One meaning of a draft course. A Hub-owned course's `is_draft` (hidden from members and from the list
-- they see, 20270323000000) follows its setting; an imported course's setting follows its `is_draft`, which
-- the sync and the publish step already write.
CREATE FUNCTION public.courses_sync_publishing_option() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'hub' THEN
    NEW.is_draft := NEW.publishing_option = 'draft';
  ELSE
    NEW.publishing_option := CASE WHEN NEW.is_draft THEN 'draft' ELSE 'published' END;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER courses_sync_publishing_option
  BEFORE INSERT OR UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.courses_sync_publishing_option();

------------------------------------------------------------------------------------------------
-- The rule, in the database
------------------------------------------------------------------------------------------------

CREATE FUNCTION public.course_visibility(p_option text) RETURNS text
  LANGUAGE sql IMMUTABLE
  SET search_path = ''
AS $$
  SELECT CASE p_option WHEN 'published' THEN 'open' WHEN 'locked' THEN 'coming_soon' WHEN 'drip' THEN 'coming_soon' ELSE 'hidden' END
$$;

-- The less visible of two states (hidden < coming_soon < open).
CREATE FUNCTION public.course_least_visible(a text, b text) RETURNS text
  LANGUAGE sql IMMUTABLE
  SET search_path = ''
AS $$
  SELECT CASE WHEN a = 'hidden' OR b = 'hidden' THEN 'hidden' WHEN a = 'coming_soon' OR b = 'coming_soon' THEN 'coming_soon' ELSE 'open' END
$$;

-- What an item's state is, given its setting and the state of what is above it.
CREATE FUNCTION public.course_item_state(p_option text, p_above text) RETURNS text
  LANGUAGE sql IMMUTABLE
  SET search_path = ''
AS $$
  SELECT CASE WHEN p_option = 'inherit' THEN p_above ELSE public.course_least_visible(public.course_visibility(p_option), p_above) END
$$;

-- Works every state of a Hub-owned course out again from the settings: top-level modules (below the course),
-- then submodules, then lessons. Only a state that changes is written. Called by the functions that change a
-- setting; not for anyone to call directly.
CREATE FUNCTION public.recompute_course_states(p_course_id text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  course_state text;
BEGIN
  SELECT public.course_visibility(publishing_option) INTO course_state FROM courses WHERE id = p_course_id AND source = 'hub';
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE course_modules m SET state = course_item_state(m.publishing_option, course_state)
    WHERE m.course_id = p_course_id AND m.parent_id IS NULL AND m.state IS DISTINCT FROM course_item_state(m.publishing_option, course_state);

  UPDATE course_modules c SET state = course_item_state(c.publishing_option, p.state)
    FROM course_modules p
    WHERE c.course_id = p_course_id AND c.parent_id = p.id AND c.state IS DISTINCT FROM course_item_state(c.publishing_option, p.state);

  UPDATE course_lessons l SET state = course_item_state(l.publishing_option, m.state)
    FROM course_modules m
    WHERE l.course_id = p_course_id AND l.module_id = m.id AND l.state IS DISTINCT FROM course_item_state(l.publishing_option, m.state);

  UPDATE course_lessons l SET state = course_item_state(l.publishing_option, course_state)
    WHERE l.course_id = p_course_id AND l.module_id IS NULL AND l.state IS DISTINCT FROM course_item_state(l.publishing_option, course_state);
END $$;

REVOKE ALL ON FUNCTION public.recompute_course_states(text) FROM PUBLIC, anon, authenticated;

-- A Hub-owned item that is added gets the state its setting and what is above it give, whatever state the
-- caller passed, so a new lesson in a published course is open straight away (it follows the course) and a
-- new one in a draft course is hidden. Later changes go through the functions below, which recompute.
CREATE FUNCTION public.course_module_initial_state() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  NEW.state := course_item_state(
    NEW.publishing_option,
    CASE WHEN NEW.parent_id IS NOT NULL THEN coalesce((SELECT state FROM course_modules WHERE id = NEW.parent_id), 'hidden')
         ELSE coalesce((SELECT course_visibility(publishing_option) FROM courses WHERE id = NEW.course_id), 'hidden') END
  );
  RETURN NEW;
END $$;

CREATE FUNCTION public.course_lesson_initial_state() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  NEW.state := course_item_state(
    NEW.publishing_option,
    CASE WHEN NEW.module_id IS NOT NULL THEN coalesce((SELECT state FROM course_modules WHERE id = NEW.module_id), 'hidden')
         ELSE coalesce((SELECT course_visibility(publishing_option) FROM courses WHERE id = NEW.course_id), 'hidden') END
  );
  RETURN NEW;
END $$;

CREATE TRIGGER course_module_initial_state BEFORE INSERT ON public.course_modules
  FOR EACH ROW WHEN (NEW.source = 'hub') EXECUTE FUNCTION public.course_module_initial_state();
CREATE TRIGGER course_lesson_initial_state BEFORE INSERT ON public.course_lessons
  FOR EACH ROW WHEN (NEW.source = 'hub') EXECUTE FUNCTION public.course_lesson_initial_state();

------------------------------------------------------------------------------------------------
-- Changing a setting: one entry in the audit log for the thing that was changed
------------------------------------------------------------------------------------------------

-- The whole course: draft, published or locked. Everything in the course follows (or is limited by) it.
-- The course's own entry says what was meant; the states underneath that merely follow aren't audited
-- row by row (see the triggers below).
CREATE FUNCTION public.set_course_status(p_course_id text, p_option text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_source text;
  v_old text;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  IF p_option NOT IN ('draft', 'published', 'locked') THEN
    RAISE EXCEPTION 'unsupported_status';
  END IF;
  SELECT source, publishing_option INTO v_source, v_old FROM courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_source <> 'hub' THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  IF v_old = p_option THEN
    RETURN;
  END IF;
  UPDATE courses SET publishing_option = p_option WHERE id = p_course_id;
  PERFORM public.recompute_course_states(p_course_id);
END $$;

-- A module or lesson: inherit (follow what is above it), draft, published or locked. Scheduled and drip need
-- a date or a delay the Hub doesn't take yet, so they are refused here, not stored half-set.
--
-- Nothing is refused for what is above it: an item can be set to published under a draft module or in a
-- draft course. It is not visible until what is above it is (its state is limited by it), so a whole module
-- can be prepared, every lesson in it marked published, and then switched on or off by its own setting alone.
-- (Kajabi does the same: "Meet Your Instructor" is Published inside the draft module "Welcome to the 180".)
CREATE FUNCTION public.set_course_item_status(p_kind text, p_id text, p_option text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_course text;
  v_old text;
  v_source text;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  IF p_kind NOT IN ('module', 'lesson') THEN
    RAISE EXCEPTION 'unknown_kind';
  END IF;
  IF p_option NOT IN ('inherit', 'draft', 'published', 'locked') THEN
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

REVOKE ALL ON FUNCTION public.set_course_status(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_course_item_status(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_course_status(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_course_item_status(text, text, text) TO authenticated;

-- A state that only follows from a setting above it is not a change worth an entry (as `position` isn't):
-- the entry for the item that was changed says what was meant. (Replaces the update triggers of
-- 20270317000000; a course's own entry, from 20270315000000, already carries its setting and the draft flag
-- that follows it.)
DROP TRIGGER audit_row_change_hub_update ON public.course_modules;
CREATE TRIGGER audit_row_change_hub_update
  AFTER UPDATE ON public.course_modules
  FOR EACH ROW WHEN (NEW.source = 'hub' AND (to_jsonb(OLD) - 'position' - 'state' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'position' - 'state' - 'updated_at'))
  EXECUTE FUNCTION audit_row_change('course_module', 'id');
DROP TRIGGER audit_row_change_hub_update ON public.course_lessons;
CREATE TRIGGER audit_row_change_hub_update
  AFTER UPDATE ON public.course_lessons
  FOR EACH ROW WHEN (NEW.source = 'hub' AND (to_jsonb(OLD) - 'position' - 'state' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'position' - 'state' - 'updated_at'))
  EXECUTE FUNCTION audit_row_change('course_lesson', 'id');

------------------------------------------------------------------------------------------------
-- A copy is a draft in its setting too, not only in its state (replaces the functions of 20270317000000)
------------------------------------------------------------------------------------------------

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
  new_id text;
  new_child_id text;
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

  INSERT INTO course_lessons (course_id, module_id, title, position, state, publishing_option, body_html, excerpt, thumbnail_url, thumbnail_source, thumbnail_asset_id, video_id, duration_seconds, source)
  SELECT l.course_id, new_id, l.title, l.position, 'hidden', 'draft', l.body_html, l.excerpt, l.thumbnail_url, l.thumbnail_source, l.thumbnail_asset_id, l.video_id, l.duration_seconds, 'hub'
    FROM course_lessons l WHERE l.module_id = p_module_id;

  FOR child IN SELECT * FROM course_modules WHERE parent_id = p_module_id ORDER BY position LOOP
    INSERT INTO course_modules (course_id, parent_id, title, position, state, publishing_option, poster_url, poster_source, poster_asset_id, source)
    VALUES (child.course_id, new_id, child.title, child.position, 'hidden', 'draft', child.poster_url, child.poster_source, child.poster_asset_id, 'hub')
    RETURNING id INTO new_child_id;
    INSERT INTO course_lessons (course_id, module_id, title, position, state, publishing_option, body_html, excerpt, thumbnail_url, thumbnail_source, thumbnail_asset_id, video_id, duration_seconds, source)
    SELECT l.course_id, new_child_id, l.title, l.position, 'hidden', 'draft', l.body_html, l.excerpt, l.thumbnail_url, l.thumbnail_source, l.thumbnail_asset_id, l.video_id, l.duration_seconds, 'hub'
      FROM course_lessons l WHERE l.module_id = child.id;
  END LOOP;
  RETURN new_id;
END $$;

NOTIFY pgrst, 'reload schema';
