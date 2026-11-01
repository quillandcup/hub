-- Take over a course from Kajabi: a course imported from Kajabi (`source = 'kajabi'`) becomes a Hub-owned
-- one (`source = 'hub'`), so it can be edited in the Hub; the Kajabi import stops touching it, because every
-- import step looks only at `source = 'kajabi'` rows. The ids stay the same (members' progress, access and
-- the addresses members use keep working), and so do the videos, downloads and images. One way: nothing
-- turns a Hub-owned course back into an imported one.

set lock_timeout = '5s';

-- The audit log records the intent once: the course's own entry says it was taken over ({"source": kajabi
-- -> hub}). Without this, flipping every module and lesson would write an entry per row (their `source`
-- changed), so the update triggers only watch rows that were already Hub-owned. (Replaces the triggers of
-- 20270401000000, which skipped only position, state and updated_at.)
DROP TRIGGER audit_row_change_hub_update ON public.course_modules;
CREATE TRIGGER audit_row_change_hub_update
  AFTER UPDATE ON public.course_modules
  FOR EACH ROW WHEN (NEW.source = 'hub' AND OLD.source = 'hub' AND (to_jsonb(OLD) - 'position' - 'state' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'position' - 'state' - 'updated_at'))
  EXECUTE FUNCTION audit_row_change('course_module', 'id');
DROP TRIGGER audit_row_change_hub_update ON public.course_lessons;
CREATE TRIGGER audit_row_change_hub_update
  AFTER UPDATE ON public.course_lessons
  FOR EACH ROW WHEN (NEW.source = 'hub' AND OLD.source = 'hub' AND (to_jsonb(OLD) - 'position' - 'state' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'position' - 'state' - 'updated_at'))
  EXECUTE FUNCTION audit_row_change('course_lesson', 'id');

-- Admin or the service role; an unknown course is `not_found`; one that is already Hub-owned is `not_editable`;
-- one whose modules nest deeper than the editor does (a module has submodules, a submodule has lessons only)
-- is `too_deep`, and is left as it is.
CREATE FUNCTION public.take_over_kajabi_course(p_course_id text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_source text;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
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

COMMENT ON FUNCTION public.take_over_kajabi_course(text) IS
  'Turns a course imported from Kajabi into a Hub-owned one (one way): the Kajabi import skips it from then on. One audit entry, for the course.';
