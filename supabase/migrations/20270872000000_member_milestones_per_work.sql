-- Finisher milestones belong to a work, not to a profile (docs/product/FINISHERS.md): a member has THE END, publish-ready and
-- published for each of their projects and Bookshelf books, so a row names ONE work: a writing project and/or a Bookshelf book
-- (a book that has a project is the same work as that project), or neither with a short `title` the member wrote for a work
-- that is not listed. Expand only: a new column, a wider unique index (the old one only allowed one row per member and kind),
-- a new backfill function (the old one stays until the contract step, docs/TODO.md "Finisher record: what is left") and a
-- policy that now also lets a member link one of their own live books. Rows that exist stay valid: a row with no work
-- (the old shape) keeps the work key '' and is still one per member and kind.

set lock_timeout = '5s';

-- The name of a work that is not a project or a book; the member's own words, so never in the audit rows (below).
ALTER TABLE public.member_milestones
  ADD COLUMN title text CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 120);

COMMENT ON COLUMN public.member_milestones.title IS
  'The name of a work that is not a project or a Bookshelf book (written by the member, or staff for a hand-added proposal). Null when the row names a project or a book. Redacted in the audit log.';

-- One live row per member, kind and work. The work key is the project when there is one (a book's project and the book are
-- one work), else the book, else the lower-cased title, else '' (a row that names no work, the old shape).
DROP INDEX public.member_milestones_live_unique;
CREATE UNIQUE INDEX member_milestones_live_work_unique
  ON public.member_milestones (member_id, kind, (coalesce(project_id, book_id, 'title:' || lower(btrim(title)), '')))
  WHERE deleted_at IS NULL;

-- The audit rows keep redacting the stories, and now the title too.
DROP TRIGGER audit_row_change_insert ON public.member_milestones;
DROP TRIGGER audit_row_change_update ON public.member_milestones;
CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.member_milestones
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('member_milestone', 'id', 'story_before,story_after,title');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.member_milestones
  FOR EACH ROW WHEN ((to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))
  EXECUTE FUNCTION public.audit_row_change('member_milestone', 'id', 'story_before,story_after,title');

-- A member's own milestone may now link one of their own live books as well as one of their own live projects.
DROP POLICY "Members add their own milestones" ON public.member_milestones;
CREATE POLICY "Members add their own milestones" ON public.member_milestones
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = (SELECT public.current_member_id())
    AND (SELECT public.current_acting_as_member_id()) IS NULL
    AND source = 'member'
    AND status = 'confirmed'
    AND confirmed_at IS NOT NULL
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (
      project_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.writing_projects p
        WHERE p.id = member_milestones.project_id
          AND p.member_id = (SELECT public.current_member_id())
          AND p.deleted_at IS NULL
      )
    )
    AND (
      book_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.member_books b
        WHERE b.id = member_milestones.book_id
          AND b.member_id = (SELECT public.current_member_id())
          AND b.deleted_at IS NULL
      )
    )
  );

-- Staff backfill, per published book: for every live book, propose both kinds for that work unless the work already has a
-- row of that kind in any status (answered, declined or taken back all count, so a no stays a no). A book and its project
-- are one work, so a row on either keeps the book from being proposed again. One set-based statement run as the calling
-- admin (RLS refuses anyone else), no page limit, a second run adds nothing. Returns how many proposals it added, for how
-- many members, across how many books.
CREATE FUNCTION public.propose_milestones_for_books()
RETURNS TABLE (proposals integer, members integer, books integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT b.member_id, b.id AS book_id, b.project_id, k.kind
    FROM public.member_books b
    CROSS JOIN (VALUES ('the_end'), ('publish_ready')) AS k(kind)
    WHERE b.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.member_milestones x
        WHERE x.member_id = b.member_id AND x.kind = k.kind
          AND (x.book_id = b.id OR (b.project_id IS NOT NULL AND x.project_id = b.project_id))
      )
  ), added AS (
    INSERT INTO public.member_milestones (member_id, kind, project_id, book_id, source, status, created_by)
    SELECT c.member_id, c.kind, c.project_id, c.book_id, 'staff', 'proposed', auth.uid() FROM candidates c
    ON CONFLICT DO NOTHING
    RETURNING member_id, book_id
  )
  SELECT count(*)::integer, count(DISTINCT a.member_id)::integer, count(DISTINCT a.book_id)::integer FROM added a;
END $$;

REVOKE ALL ON FUNCTION public.propose_milestones_for_books() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_milestones_for_books() TO authenticated, service_role;

COMMENT ON FUNCTION public.propose_milestones_for_books() IS
  'Admin: for every live book, proposes the_end and publish_ready for that work unless the work (the book, or its project) already has a milestone of that kind in any status. Idempotent; returns (proposals, members, books) added.';
