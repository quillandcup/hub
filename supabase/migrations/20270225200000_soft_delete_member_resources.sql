-- Soft delete for the things a member can delete in the app: progress entries, goals, books and awards.
--
-- Until now these were row DELETEs (the audit log kept the field values). Local tables soft delete
-- (`deleted_at IS NULL` means live; see CLAUDE.md), so the app now sets `deleted_at` instead and
-- reads only live rows. The row, with the member's own words, stays until the member asks us to
-- remove it, which is what /privacy tells them.
--
-- Hiding rests on two layers: the app filters `deleted_at IS NULL` on every read (the writing
-- repository, the bookshelf and awards queries), and the "everyone can view" policies below hide a
-- deleted book or award from other members. The owner's and admins' policy ("manage their own")
-- still lets them see the row, which is also what lets the soft-delete UPDATE return it.

ALTER TABLE public.writing_progress_entries ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.writing_goals ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.member_books ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.member_awards ADD COLUMN deleted_at timestamptz;

-- One book per project: a deleted book must not block publishing the project again.
DROP INDEX IF EXISTS public.idx_member_books_project_id_unique;
CREATE UNIQUE INDEX idx_member_books_project_id_unique
  ON public.member_books (project_id)
  WHERE project_id IS NOT NULL AND deleted_at IS NULL;

-- Other members see only live books and awards.
DROP POLICY "Authenticated users can view member_books" ON public.member_books;
CREATE POLICY "Authenticated users can view member_books" ON public.member_books
  FOR SELECT USING (auth.role() = 'authenticated' AND deleted_at IS NULL);

DROP POLICY "Authenticated users can view member_awards" ON public.member_awards;
CREATE POLICY "Authenticated users can view member_awards" ON public.member_awards
  FOR SELECT USING (auth.role() = 'authenticated' AND deleted_at IS NULL);

-- The profile's writing section: deleted goals and entries never show on a profile.
CREATE OR REPLACE FUNCTION public.get_profile_writing(p_member_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH shown_projects AS (
    SELECT p.id, p.title
    FROM public.writing_projects p
    WHERE p.member_id = p_member_id AND p.show_on_profile AND p.archived_at IS NULL
  ),
  shown_goals AS (
    SELECT g.id, g.project_id, p.title AS project_title, g.goal_type, g.measure, g.target_amount,
           g.start_date, g.end_date, g.habit_period, g.habit_threshold, g.title, g.description
    FROM public.writing_goals g
    JOIN public.writing_projects p ON p.id = g.project_id AND p.archived_at IS NULL
    WHERE g.member_id = p_member_id AND g.show_on_profile AND g.archived_at IS NULL AND g.deleted_at IS NULL
  ),
  measured_projects AS (
    SELECT id FROM shown_projects
    UNION
    SELECT project_id FROM shown_goals
  )
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE jsonb_build_object(
    'projects', COALESCE((SELECT jsonb_agg(to_jsonb(sp)) FROM shown_projects sp), '[]'::jsonb),
    'goals', COALESCE((SELECT jsonb_agg(to_jsonb(sg)) FROM shown_goals sg), '[]'::jsonb),
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'project_id', e.project_id, 'entry_date', e.entry_date, 'measure', e.measure,
        'mode', e.mode, 'amount', e.amount, 'created_at', e.created_at))
      FROM public.writing_progress_entries e
      WHERE e.member_id = p_member_id AND e.deleted_at IS NULL
        AND e.project_id IN (SELECT id FROM measured_projects)
    ), '[]'::jsonb),
    'starting_balances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('project_id', b.project_id, 'measure', b.measure, 'amount', b.amount))
      FROM public.writing_project_starting_balances b
      WHERE b.member_id = p_member_id AND b.project_id IN (SELECT id FROM shown_projects)
    ), '[]'::jsonb)
  ) END;
$function$;

COMMENT ON COLUMN public.writing_progress_entries.deleted_at IS 'Soft delete: set when the member deletes the entry; NULL means live.';
COMMENT ON COLUMN public.writing_goals.deleted_at IS 'Soft delete: set when the member deletes the goal (archived_at is "mark as done" and is separate); NULL means live.';
COMMENT ON COLUMN public.member_books.deleted_at IS 'Soft delete: set when the member removes the book from their bookshelf; NULL means live.';
COMMENT ON COLUMN public.member_awards.deleted_at IS 'Soft delete: set when the member removes the award; NULL means live.';
