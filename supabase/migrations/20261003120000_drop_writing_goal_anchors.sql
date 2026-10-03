-- Drop prickles-measure goal anchors (20260830120000). An anchor limited which prickles a goal
-- counted (one schedule's type/host/weekday) and, for the pre-prickle nudge, which prickles to
-- nudge before. Commitments already say "I'll be at this slot", with the calendar and kept/missed
-- tracking behind them, so the two overlapped with separate UX. A prickles-measure goal now counts
-- every writing prickle attended, and nudges follow the member's calendar. Linking a goal to a
-- commitment instead is planned in docs/COMMITMENTS.md. No production goal had an anchor set.

-- get_profile_writing returned the anchor columns; redefine it without them before dropping them.
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
           g.start_date, g.end_date, g.habit_period, g.habit_threshold, g.title, g.description
    FROM public.writing_goals g
    JOIN public.writing_projects p ON p.id = g.project_id AND p.archived_at IS NULL
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

ALTER TABLE public.writing_goals
  DROP COLUMN IF EXISTS anchor_schedule_id,
  DROP COLUMN IF EXISTS anchor_type_id,
  DROP COLUMN IF EXISTS anchor_host_id,
  DROP COLUMN IF EXISTS anchor_day_of_week;
