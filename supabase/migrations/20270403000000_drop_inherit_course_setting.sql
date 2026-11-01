-- Second of two steps to remove the 'inherit' setting ("follow what is above it") from course modules and
-- lessons (expand, then contract; see CLAUDE.md, "Migrations: expand, then contract"). The first, #764, stopped
-- the editor from offering or writing it (new items start as drafts) and is deployed. Kajabi has no such
-- setting, and no production row had it (checked 2026-11-01).

set lock_timeout = '5s';

-- A row that still has it (a local database from before #764) becomes a draft, and the states are worked out again.
DO $$
DECLARE
  v_courses text[];
  v_course text;
BEGIN
  SELECT coalesce(array_agg(DISTINCT course_id), '{}') INTO v_courses FROM (
    SELECT course_id FROM public.course_modules WHERE publishing_option = 'inherit'
    UNION ALL SELECT course_id FROM public.course_lessons WHERE publishing_option = 'inherit') x;
  UPDATE public.course_modules SET publishing_option = 'draft' WHERE publishing_option = 'inherit';
  UPDATE public.course_lessons SET publishing_option = 'draft' WHERE publishing_option = 'inherit';
  FOREACH v_course IN ARRAY v_courses LOOP
    PERFORM public.recompute_course_states(v_course);
  END LOOP;
END $$;

-- Hub-owned rows may be draft, published, locked (and the scheduled and drip Kajabi has, which the editor doesn't offer yet).
-- Approved ban-drop-constraint ignore: the last write of 'inherit' was removed in #764, which is deployed.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.course_modules DROP CONSTRAINT course_modules_hub_publishing_option;
ALTER TABLE public.course_modules ADD CONSTRAINT course_modules_hub_publishing_option
  CHECK (source <> 'hub' OR coalesce(publishing_option IN ('draft', 'published', 'scheduled', 'drip', 'locked'), false)) NOT VALID;
ALTER TABLE public.course_modules VALIDATE CONSTRAINT course_modules_hub_publishing_option;

-- Approved ban-drop-constraint ignore: the last write of 'inherit' was removed in #764, which is deployed.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.course_lessons DROP CONSTRAINT course_lessons_hub_publishing_option;
ALTER TABLE public.course_lessons ADD CONSTRAINT course_lessons_hub_publishing_option
  CHECK (source <> 'hub' OR coalesce(publishing_option IN ('draft', 'published', 'scheduled', 'drip', 'locked'), false)) NOT VALID;
ALTER TABLE public.course_lessons VALIDATE CONSTRAINT course_lessons_hub_publishing_option;

-- A row added without a setting is a draft, like Kajabi's.
ALTER TABLE public.course_modules ALTER COLUMN publishing_option SET DEFAULT 'draft';
ALTER TABLE public.course_lessons ALTER COLUMN publishing_option SET DEFAULT 'draft';

COMMENT ON COLUMN public.course_modules.publishing_option IS
  'The module''s own setting: draft, published, scheduled, drip or locked. Its state (what members get) follows from this and what is above it. For an imported course this is whatever Kajabi says, including nothing.';
COMMENT ON COLUMN public.course_lessons.publishing_option IS
  'The lesson''s own setting: draft, published, scheduled, drip or locked. Its state (what members get) follows from this and what is above it. For an imported course this is whatever Kajabi says, including nothing.';

-- What an item's state is, given its setting and the state of what is above it (no setting follows what is above it any more).
CREATE OR REPLACE FUNCTION public.course_item_state(p_option text, p_above text) RETURNS text
  LANGUAGE sql IMMUTABLE
  SET search_path = ''
AS $$
  SELECT public.course_least_visible(public.course_visibility(p_option), p_above)
$$;

-- A module or lesson: draft, published or locked. Scheduled and drip need a date or a delay the Hub doesn't take
-- yet, so they are refused here, not stored half-set. Nothing is refused for what is above it (see 20270401000000).
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
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
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
