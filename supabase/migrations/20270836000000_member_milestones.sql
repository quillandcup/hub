-- The Finisher record (docs/FINISHERS.md): a member's writing milestones, kept apart from the project they came from.
-- Two are stored, `the_end` (they wrote THE END) and `publish_ready` (they revised it until it was ready to publish);
-- the third, published, is never stored: it is derived from member_books. A row is a claim about a person, so it starts
-- as `proposed` (staff or a course suggested it) and only the member makes it `confirmed`, or `declined`. Consent to show
-- it on a public profile, on the homepage or as a testimonial is a separate tick per use, off until the member ticks it,
-- and only on a confirmed row. Nothing reads these rows but the member and admins: no other member, no visitor.
-- Expand only: a new table and a function, nothing existing changes.

set lock_timeout = '5s';

CREATE TABLE public.member_milestones (
  id text PRIMARY KEY DEFAULT public.new_id('mlst'),
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('the_end', 'publish_ready')),
  project_id text REFERENCES public.writing_projects(id) ON DELETE SET NULL,
  book_id text REFERENCES public.member_books(id) ON DELETE SET NULL,
  -- When it happened; null when nobody knows (a backfilled row).
  achieved_on date,
  story_before text CHECK (story_before IS NULL OR char_length(story_before) <= 2000),
  story_after text CHECK (story_after IS NULL OR char_length(story_after) <= 2000),
  -- Who started the row: the member, a project's stage change, a course completion, or staff.
  source text NOT NULL CHECK (source IN ('member', 'project_stage', 'course', 'staff')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'declined')),
  -- One tick per use, all off until the member ticks them.
  consent_profile boolean NOT NULL DEFAULT false,
  consent_homepage boolean NOT NULL DEFAULT false,
  consent_testimonial boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  -- Confirmed means the member said so, and when.
  CONSTRAINT member_milestones_confirmed_at CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL)),
  -- A consent only exists on a row the member confirmed.
  CONSTRAINT member_milestones_consent_needs_confirmed CHECK (status = 'confirmed' OR NOT (consent_profile OR consent_homepage OR consent_testimonial))
);

-- One live row per member, kind and project (no project counts as one project), so a backfill can run again.
CREATE UNIQUE INDEX member_milestones_live_unique
  ON public.member_milestones (member_id, kind, coalesce(project_id, ''))
  WHERE deleted_at IS NULL;
CREATE INDEX member_milestones_status_idx ON public.member_milestones (status) WHERE deleted_at IS NULL;
CREATE INDEX member_milestones_project_idx ON public.member_milestones (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX member_milestones_book_idx ON public.member_milestones (book_id) WHERE book_id IS NOT NULL;

COMMENT ON TABLE public.member_milestones IS
  'LOCAL: a member''s Finisher milestones (the_end, publish_ready; published is derived from member_books). Starts proposed, only the member confirms or declines it, consent per use (profile, homepage, testimonial) defaults off. Readable only by the member and admins. Tier 2: the id is never shown. [id prefix: mlst_]';

ALTER TABLE public.member_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own milestones" ON public.member_milestones
  FOR SELECT TO authenticated
  USING ((member_id = (SELECT public.current_member_id()) AND deleted_at IS NULL) OR (SELECT public.is_admin()));

-- Staff propose milestones for members; a proposal is never confirmed on the member's behalf.
CREATE POLICY "Admins propose milestones" ON public.member_milestones
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()) AND source = 'staff' AND status = 'proposed' AND confirmed_at IS NULL);

-- The member answers for themselves, never while an admin previews as them.
CREATE POLICY "Members answer their own milestones" ON public.member_milestones
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL)
  WITH CHECK (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL);

-- Admins may only edit (or withdraw) a row that is still a proposal, and leave it one.
CREATE POLICY "Admins edit proposed milestones" ON public.member_milestones
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()) AND status = 'proposed')
  WITH CHECK ((SELECT public.is_admin()) AND status = 'proposed');

-- Soft delete only (no DELETE); a member's own row can't be moved to another member or kind.
REVOKE ALL ON public.member_milestones FROM anon, authenticated;
GRANT SELECT, INSERT ON public.member_milestones TO authenticated;
GRANT UPDATE (achieved_on, story_before, story_after, status, consent_profile, consent_homepage, consent_testimonial, confirmed_at, updated_at, deleted_at)
  ON public.member_milestones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_milestones TO service_role;

-- Activity Log: the row's own change is the entry (a proposal, a confirmation, a withdrawal), never the stories.
CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.member_milestones
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('member_milestone', 'id', 'story_before,story_after');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.member_milestones
  FOR EACH ROW WHEN ((to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))
  EXECUTE FUNCTION public.audit_row_change('member_milestone', 'id', 'story_before,story_after');

-- Staff backfill: every member with a live book is a Finisher twice over (a published book implies they wrote THE END and
-- revised it), so propose both for each member who has no row of that kind yet, whatever its status or whether it was
-- withdrawn (a decline or a withdrawal stays). One set-based statement, so it has no page limit and a second run adds
-- nothing. Runs as the caller (an admin; RLS refuses anyone else). Returns how many rows it added.
CREATE FUNCTION public.propose_milestones_from_books()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  added integer;
BEGIN
  INSERT INTO public.member_milestones (member_id, kind, source, status, created_by)
  SELECT m.member_id, k.kind, 'staff', 'proposed', auth.uid()
  FROM (SELECT DISTINCT b.member_id FROM public.member_books b WHERE b.deleted_at IS NULL) m
  CROSS JOIN (VALUES ('the_end'), ('publish_ready')) AS k(kind)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.member_milestones x WHERE x.member_id = m.member_id AND x.kind = k.kind
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS added = ROW_COUNT;
  RETURN added;
END $$;

REVOKE ALL ON FUNCTION public.propose_milestones_from_books() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_milestones_from_books() TO authenticated, service_role;

COMMENT ON FUNCTION public.propose_milestones_from_books() IS
  'Admin: proposes the_end and publish_ready for every member with a live book who has no milestone of that kind yet. Idempotent; returns the number of rows added.';

-- A removal request (supabase/tests/database/member_data_handling.test.sql keeps this list complete): the stories and
-- dates are the member's own words and mean nothing without them.
INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('member_milestones', 'member_id', 'delete', 'their Finisher milestones, with their own dates and stories, which they confirmed for specific uses');
