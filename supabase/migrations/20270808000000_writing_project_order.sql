-- Members can put their writing projects in the order they like.
--
-- `sort_position` is the project's place in the member's own list: 1, 2, 3 ... and NULL for a project
-- that was never placed. A list sorts the NULLs first (newest first, as the list has always been), then
-- the placed ones by position. So nobody sees a change until they reorder, a project created afterwards
-- appears at the top like it does today, and a project that comes back from hibernating (never placed, or
-- placed long ago) isn't lost at the bottom. The dashboard's starred goals follow the same order.
--
-- Expand only: a nullable column, nothing existing is read differently until the app starts sorting by it.

set lock_timeout = '5s';

ALTER TABLE public.writing_projects ADD COLUMN sort_position integer;

COMMENT ON COLUMN public.writing_projects.sort_position IS 'The member''s own order of their projects (1 = first); NULL = never placed, which sorts before every placed project, newest first.';

-- A reorder rewrites the position of every project in the list, so it is one audit entry for the member's
-- list ("reordered their 4 projects"), not one per project (docs/architecture/ACTIVITY_AND_AUDIT_LOG.md, "Record the
-- intent, not the noise"). The row trigger stays for everything else a project does: it is split in
-- three so the update one can say a change of position alone is not worth a row (OLD isn't there on insert).
DROP TRIGGER audit_row_change ON public.writing_projects;

CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.writing_projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('writing_project', 'id', '');

CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.writing_projects
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - 'sort_position') IS DISTINCT FROM (to_jsonb(NEW) - 'sort_position')
  )
  EXECUTE FUNCTION public.audit_row_change('writing_project', 'id', '');

CREATE TRIGGER audit_row_change_delete
  AFTER DELETE ON public.writing_projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('writing_project', 'id', '');

-- Puts the given projects of the member in the given order, in one statement. Ids that aren't the
-- member's live projects are ignored (nothing of anyone else's is touched), a repeated id counts once,
-- and projects not in the list keep their position, so reordering the active ones leaves hibernating
-- ones alone. Running it again with the same list changes nothing and writes nothing.
--
-- It runs with its owner's rights so it can write the audit entry (only the audit triggers can write the
-- audit log), and so does the check the row policies would: the caller is the member, an admin (sudo
-- acts through the admin's own session) or the server itself.
CREATE OR REPLACE FUNCTION public.reorder_writing_projects(p_member_id text, p_ids text[])
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
  PERFORM 1 FROM public.writing_projects
    WHERE member_id = p_member_id AND deleted_at IS NULL AND id = ANY (p_ids)
    ORDER BY id FOR UPDATE;

  WITH given AS (
    SELECT u.id, min(u.ord) AS ord FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord) GROUP BY u.id
  ), mine AS (
    SELECT p.id, p.sort_position, p.created_at, g.ord
      FROM public.writing_projects p JOIN given g ON g.id = p.id
      WHERE p.member_id = p_member_id AND p.deleted_at IS NULL
  )
  SELECT
    coalesce((SELECT array_agg(id ORDER BY sort_position ASC NULLS FIRST, created_at DESC, id DESC) FROM mine), '{}'),
    coalesce((SELECT array_agg(id ORDER BY ord) FROM mine), '{}')
  INTO old_ids, new_ids;

  UPDATE public.writing_projects p SET sort_position = o.pos
    FROM (SELECT x.id, row_number() OVER (ORDER BY x.ord)::integer AS pos
            FROM (SELECT u.id, min(u.ord) AS ord FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord) GROUP BY u.id) x
            WHERE x.id = ANY (new_ids)) o
    WHERE p.id = o.id AND p.member_id = p_member_id AND p.deleted_at IS NULL AND p.sort_position IS DISTINCT FROM o.pos;

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
      public.current_acting_as_member_id(), 'writing_project_order', p_member_id, 'update',
      jsonb_build_object('order', jsonb_build_object('old', to_jsonb(old_ids), 'new', to_jsonb(new_ids))),
      p_member_id
    );
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.reorder_writing_projects(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_writing_projects(text, text[]) TO authenticated, service_role;
