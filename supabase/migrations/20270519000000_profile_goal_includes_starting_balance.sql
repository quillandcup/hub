-- A goal shared on the profile showed only the entries logged, not the project's starting balance,
-- when the project itself was not shared: 22% on the profile against 74% on the member's own
-- dashboard. Starting balances now follow the same projects as the entries (measured_projects).

set lock_timeout = '5s';

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
    WHERE p.member_id = p_member_id AND p.show_on_profile AND p.deleted_at IS NULL
  ),
  shown_goals AS (
    SELECT g.id, g.project_id, p.title AS project_title, g.goal_type, g.measure, g.target_amount,
           g.start_date, g.end_date, g.habit_period, g.habit_threshold, g.title, g.description
    FROM public.writing_goals g
    JOIN public.writing_projects p ON p.id = g.project_id AND p.deleted_at IS NULL
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
      WHERE b.member_id = p_member_id AND b.project_id IN (SELECT id FROM measured_projects)
    ), '[]'::jsonb)
  ) END;
$function$;
