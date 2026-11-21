-- Members can put the goals of a writing project in the order they like.
--
-- `sort_position` is the goal's place in its project's list: 1, 2, 3 ... and NULL for a goal that was never
-- placed. A project's goals list the placed ones by position, then the unplaced ones by id (the order they
-- have always had), so nobody sees a change until they reorder, and a goal created afterwards goes to the
-- end of the list instead of wherever its random id falls.
--
-- Expand only: a nullable column, nothing existing is read differently until the app starts sorting by it.

set lock_timeout = '5s';

ALTER TABLE public.writing_goals ADD COLUMN sort_position integer;

COMMENT ON COLUMN public.writing_goals.sort_position IS 'The member''s own order of the goals in one project (1 = first); NULL = never placed, which sorts after every placed goal, by id.';

-- A reorder rewrites the position of every goal in the list, so it is one audit entry for the list
-- ("reordered the 3 goals in a project"), not one per goal (docs/architecture/ACTIVITY_AND_AUDIT_LOG.md, "Record the
-- intent, not the noise"). The row trigger stays for everything else a goal does: it is split in three so the
-- update one can say a change of position alone is not worth a row (OLD isn't there on insert).
DROP TRIGGER audit_row_change ON public.writing_goals;

CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.writing_goals
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('writing_goal', 'id', '');

CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.writing_goals
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - 'sort_position') IS DISTINCT FROM (to_jsonb(NEW) - 'sort_position')
  )
  EXECUTE FUNCTION public.audit_row_change('writing_goal', 'id', '');

CREATE TRIGGER audit_row_change_delete
  AFTER DELETE ON public.writing_goals
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('writing_goal', 'id', '');

-- Puts the given goals of one project in the given order, in one statement. Ids that aren't the member's
-- live, unarchived goals of that project are ignored (nothing of anyone else's, or of another project, is
-- touched), a repeated id counts once, and goals not in the list keep their position. Running it again with
-- the same list changes nothing and writes nothing.
--
-- It runs with its owner's rights so it can write the audit entry (only the audit triggers can write the
-- audit log), and so does the check the row policies would: the caller is the member, an admin (sudo acts
-- through the admin's own session) or the server itself.
CREATE OR REPLACE FUNCTION public.reorder_writing_goals(p_member_id text, p_project_id text, p_ids text[])
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  old_ids text[];
  new_ids text[];
BEGIN
  -- Each test is coalesced: without a member row or a role they are NULL, and NOT NULL doesn't raise.
  IF NOT (coalesce(p_member_id = public.current_member_id(), false) OR coalesce(public.is_admin(), false) OR coalesce(auth.role() = 'service_role', false)) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  -- Lock the rows in a fixed order, so two reorders at once wait for each other instead of deadlocking.
  PERFORM 1 FROM public.writing_goals
    WHERE member_id = p_member_id AND project_id = p_project_id AND archived_at IS NULL AND deleted_at IS NULL AND id::text = ANY (p_ids)
    ORDER BY id FOR UPDATE;

  -- A goal's id is a uuid (a project's is text), so the ids are compared as text.
  WITH given AS (
    SELECT u.id, min(u.ord) AS ord FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord) GROUP BY u.id
  ), mine AS (
    SELECT w.id AS gid, w.id::text AS id, w.sort_position, gv.ord
      FROM public.writing_goals w JOIN given gv ON gv.id = w.id::text
      WHERE w.member_id = p_member_id AND w.project_id = p_project_id AND w.archived_at IS NULL AND w.deleted_at IS NULL
  )
  SELECT
    coalesce((SELECT array_agg(id ORDER BY sort_position ASC NULLS LAST, gid ASC) FROM mine), '{}'),
    coalesce((SELECT array_agg(id ORDER BY ord) FROM mine), '{}')
  INTO old_ids, new_ids;

  UPDATE public.writing_goals w SET sort_position = o.pos
    FROM (SELECT x.id, row_number() OVER (ORDER BY x.ord)::integer AS pos
            FROM (SELECT u.id, min(u.ord) AS ord FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord) GROUP BY u.id) x
            WHERE x.id = ANY (new_ids)) o
    WHERE w.id::text = o.id AND w.member_id = p_member_id AND w.project_id = p_project_id AND w.archived_at IS NULL AND w.deleted_at IS NULL
      AND w.sort_position IS DISTINCT FROM o.pos;

  -- One audit entry for the reorder, as whoever did it, and none when the order is the one it was.
  IF old_ids IS DISTINCT FROM new_ids THEN
    INSERT INTO public.audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, member_id)
    VALUES (
      uid,
      CASE
        WHEN uid IS NULL THEN 'system'
        WHEN EXISTS (SELECT 1 FROM public.user_profiles WHERE id = uid AND role IN ('admin', 'assistant', 'community_manager')) THEN 'staff'
        ELSE 'member'
      END,
      public.current_acting_as_member_id(), 'writing_goal_order', p_project_id, 'update',
      jsonb_build_object('order', jsonb_build_object('old', to_jsonb(old_ids), 'new', to_jsonb(new_ids))),
      p_member_id
    );
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.reorder_writing_goals(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_writing_goals(text, text, text[]) TO authenticated, service_role;
