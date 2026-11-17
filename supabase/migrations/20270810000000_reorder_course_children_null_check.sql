-- reorder_course_children: close a NULL hole in the caller check.
--
-- The check was `IF NOT (is_admin() OR auth.role() = 'service_role') ...`. For a caller whose claims carry no
-- role, auth.role() is NULL, so `false OR NULL` is NULL, `NOT NULL` is NULL, and the IF does not raise: the
-- caller passes. Each test is now coalesced to false, as reorder_writing_projects (20270808000000) does.
-- Who may call it is unchanged (an admin, or the server itself, the service role), and so is everything else
-- in the body (see 20270327000000), the SECURITY DEFINER setting, the search_path and the grants.

set lock_timeout = '5s';

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
  IF NOT (coalesce(public.is_admin(), false) OR coalesce(auth.role() = 'service_role', false)) OR NOT EXISTS (SELECT 1 FROM courses WHERE id = p_course_id AND source = 'hub') THEN
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

REVOKE ALL ON FUNCTION public.reorder_course_children(text, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_course_children(text, text, text, text[]) TO authenticated;
