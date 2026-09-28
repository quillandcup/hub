-- Goal title, description and "show on profile" (TrackBear goals carry all three, and the
-- importer used to drop them), plus a read path for the opted-in writing data on a member's
-- profile.
--
-- Why a function for the profile: writing_projects / writing_progress_entries / writing_goals
-- are readable only by their owner (and admins). A plain SELECT policy on "shown on profile"
-- rows would also expose every entry's note and tags to all members, since RLS can't hide
-- columns per row. get_profile_writing returns just what the profile needs -- opted-in project
-- and goal fields, plus entry dates/amounts (no notes, no tags) for the projects they measure.
-- Before this, getProfileWritingSummary read the tables as the viewer, so a non-admin viewing
-- someone else's profile never saw their "Show on my profile" project.

ALTER TABLE public.writing_goals ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.writing_goals ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.writing_goals ADD COLUMN IF NOT EXISTS show_on_profile BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.writing_goals.title IS 'Optional member-given name, e.g. "Finish Draft 1".';
COMMENT ON COLUMN public.writing_goals.description IS 'Optional member-given note on what the goal is for.';
COMMENT ON COLUMN public.writing_goals.show_on_profile IS
  'Member opted this goal onto their public profile (see get_profile_writing). Defaults to private.';

CREATE OR REPLACE FUNCTION public.get_profile_writing(p_member_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH shown_projects AS (
    SELECT p.id, p.title
    FROM public.writing_projects p
    WHERE p.member_id = p_member_id AND p.show_on_profile AND p.archived_at IS NULL
  ),
  shown_goals AS (
    SELECT g.id, g.project_id, p.title AS project_title, g.goal_type, g.measure, g.target_amount,
           g.start_date, g.end_date, g.habit_period, g.habit_threshold, g.title, g.description,
           g.anchor_type_id, g.anchor_host_id, g.anchor_day_of_week,
           t.name AS anchor_type_name, h.name AS anchor_host_name
    FROM public.writing_goals g
    JOIN public.writing_projects p ON p.id = g.project_id AND p.archived_at IS NULL
    LEFT JOIN public.prickle_types t ON t.id = g.anchor_type_id
    LEFT JOIN public.member_directory h ON h.id = g.anchor_host_id
    WHERE g.member_id = p_member_id AND g.show_on_profile AND g.archived_at IS NULL
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
      WHERE e.member_id = p_member_id AND e.project_id IN (SELECT id FROM measured_projects)
    ), '[]'::jsonb),
    'starting_balances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('project_id', b.project_id, 'measure', b.measure, 'amount', b.amount))
      FROM public.writing_project_starting_balances b
      WHERE b.member_id = p_member_id AND b.project_id IN (SELECT id FROM shown_projects)
    ), '[]'::jsonb)
  ) END;
$$;

COMMENT ON FUNCTION public.get_profile_writing(UUID) IS
  'Opted-in ("show on profile") writing projects and goals of one member, for their profile page: project/goal fields plus entry dates and amounts (never notes or tags) for the projects involved, and starting balances of shown projects. Any signed-in member may call it.';

REVOKE EXECUTE ON FUNCTION public.get_profile_writing(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_writing(UUID) TO authenticated, service_role;
