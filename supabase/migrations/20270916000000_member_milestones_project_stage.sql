-- The project-stage prompt (docs/product/FINISHERS.md): when a member moves one of their projects to a stage that means a
-- milestone, the Hub asks once whether to record it. The member's answer is a row for that project with source 'project_stage':
--   * "Yes": status 'confirmed' (their own action, so no proposal step), the same as a milestone they add themselves;
--   * "Not yet": status 'declined', which is how the Hub remembers it asked, so it does not ask again when the project moves
--     forward and back. The card shows it as "You said no, or not yet" with "Actually, it is me", and the staff backfill never
--     proposes that kind for the work again (it skips any row, in any status).
-- Expand only: one new INSERT policy on an existing table; the source CHECK already allows 'project_stage'.
--
-- What the policy allows, and nothing else:
--   * the row is the signed-in member's own, never while an admin views as them (sudo), and never an admin adding one;
--   * source 'project_stage', status 'confirmed' or 'declined' (the table's CHECKs tie confirmed_at to 'confirmed', and keep the
--     level at 'private' and every consent off on a declined row);
--   * a project that is theirs and live, no book link and no free-text title (the prompt is about a project);
--   * created_by, if given, is the signed-in user.
-- One live row per member, kind and project is still the unique index; the repository reports an existing row instead of an error.

set lock_timeout = '5s';

CREATE POLICY "Members answer a project stage prompt" ON public.member_milestones
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = (SELECT public.current_member_id())
    AND (SELECT public.current_acting_as_member_id()) IS NULL
    AND source = 'project_stage'
    AND status IN ('confirmed', 'declined')
    AND book_id IS NULL
    AND title IS NULL
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.writing_projects p
      WHERE p.id = member_milestones.project_id
        AND p.member_id = (SELECT public.current_member_id())
        AND p.deleted_at IS NULL
    )
  );
