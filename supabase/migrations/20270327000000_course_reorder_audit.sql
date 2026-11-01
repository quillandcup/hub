-- Course editor: a reorder is one entry in the audit log ("reordered the 4 lessons in “Week 1”"), with
-- the order before and after. Until now a change of `position` alone was left out of the audit log
-- (20270317000000), because it rewrites every row in a list and one entry per row would bury the rest.
--
-- Nobody but the audit triggers can write the audit log, so the function that reorders now runs with
-- its owner's rights (SECURITY DEFINER) and does the checks the row-level policies did for it: the
-- caller is an admin (or the server itself, the service role, which the repository's own tests use), and
-- the course, and every row moved, is Hub-owned. Everything else about it is as before (see
-- 20270317000000). A course imported from Kajabi, a member, or someone signed out gets 'not_editable' and
-- nothing changes.

CREATE OR REPLACE FUNCTION public.reorder_course_children(p_course_id text, p_kind text, p_parent_id text, p_ids text[])
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  old_ids text[];
  current_ids text[];
  updated integer;
  label text;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') OR NOT EXISTS (SELECT 1 FROM courses WHERE id = p_course_id AND source = 'hub') THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  IF p_kind NOT IN ('module', 'lesson') THEN
    RAISE EXCEPTION 'unknown_kind';
  END IF;
  IF cardinality(p_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_ids) AS x) THEN
    RAISE EXCEPTION 'stale_order';
  END IF;

  -- The children as they are now, in their current order.
  IF p_kind = 'module' THEN
    SELECT coalesce(array_agg(id ORDER BY position, title, id), '{}') INTO old_ids
      FROM course_modules WHERE course_id = p_course_id AND parent_id IS NOT DISTINCT FROM p_parent_id;
  ELSE
    SELECT coalesce(array_agg(id ORDER BY position, title, id), '{}') INTO old_ids
      FROM course_lessons WHERE course_id = p_course_id AND module_id IS NOT DISTINCT FROM p_parent_id;
  END IF;
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO current_ids FROM unnest(old_ids) AS x;
  IF current_ids IS DISTINCT FROM (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(p_ids) AS x) THEN
    RAISE EXCEPTION 'stale_order';
  END IF;

  IF p_kind = 'module' THEN
    UPDATE course_modules m SET position = o.ord
      FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
      WHERE m.id = o.id AND m.course_id = p_course_id AND m.source = 'hub';
  ELSE
    UPDATE course_lessons l SET position = o.ord
      FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
      WHERE l.id = o.id AND l.course_id = p_course_id AND l.source = 'hub';
  END IF;
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'not_editable';
  END IF;

  -- One audit entry for the reorder, named for the list it is in (a module or the course), and none if
  -- the list was already in that order.
  IF old_ids IS DISTINCT FROM p_ids THEN
    SELECT coalesce(
      (SELECT title FROM course_modules WHERE id = p_parent_id),
      (SELECT title FROM courses WHERE id = p_course_id)
    ) INTO label;
    INSERT INTO audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, entity_label)
    VALUES (
      auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'staff' END, current_acting_as_member_id(),
      'course_' || p_kind || '_order', coalesce(p_parent_id, p_course_id), 'update',
      jsonb_build_object('order', jsonb_build_object('old', to_jsonb(old_ids), 'new', to_jsonb(p_ids))),
      label
    );
  END IF;
END $$;

-- CREATE OR REPLACE keeps the grants (authenticated only, set in 20270317000000); stated again so this file
-- reads on its own.
REVOKE ALL ON FUNCTION public.reorder_course_children(text, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_course_children(text, text, text, text[]) TO authenticated;
