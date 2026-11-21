-- Members add their own Finisher milestones (docs/product/FINISHERS.md). A member who wrote THE END can say so without
-- waiting for staff to propose it: they insert the row themselves, already confirmed, with source 'member'. Expand only:
-- one new policy on an existing table, nothing existing changes.
--
-- What the policy allows, and nothing else:
--   * the row is the signed-in member's own (member_id = current_member_id()), never while an admin views as them (sudo),
--     and never an admin adding one for a member (the admin policy only allows staff proposals);
--   * source 'member' and status 'confirmed' with a confirmation time: the member is saying it themselves, so there is no
--     proposal step. The table's own CHECK keeps a consent on a confirmed row only, so consents can come in the same insert;
--   * an optional project must be one of their own live projects; no book link (the Bookshelf is derived, not linked here);
--   * created_by, if given, is the signed-in user.
-- One live row per member, kind and project is still the unique index; the repository reports an existing row instead of an error.

set lock_timeout = '5s';

CREATE POLICY "Members add their own milestones" ON public.member_milestones
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = (SELECT public.current_member_id())
    AND (SELECT public.current_acting_as_member_id()) IS NULL
    AND source = 'member'
    AND status = 'confirmed'
    AND confirmed_at IS NOT NULL
    AND book_id IS NULL
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
  );

COMMENT ON TABLE public.member_milestones IS
  'LOCAL: a member''s Finisher milestones (the_end, publish_ready; published is derived from member_books). Staff propose (starts proposed) and the member confirms or declines; a member can also add their own, already confirmed (source member). Consent per use (profile, homepage, testimonial) defaults off and exists only on a confirmed row. Readable only by the member and admins. Tier 2: the id is never shown. [id prefix: mlst_]';

-- Taking back one of their own is a soft delete (an UPDATE that sets deleted_at). Postgres also checks the new row against
-- the SELECT policy, and the old policy hid deleted rows from the member, so the member's own take-back was refused as a
-- row-level security violation. A member may now read their own deleted rows too (the repository still filters on
-- deleted_at, so a taken-back row never shows); admins and everyone else are unchanged.
DROP POLICY "Members read their own milestones" ON public.member_milestones;
CREATE POLICY "Members read their own milestones" ON public.member_milestones
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
