set lock_timeout = '5s';

-- get_profile_writing returned its lists in whatever order the planner produced (jsonb_agg with no ORDER BY), so the
-- profile's projects and goals could swap places whenever a plan changed. Same function as in
-- 20270831000000_writing_three_level_visibility.sql, with one change: every list has an order.
--
-- Projects and goals follow the member's own order (the same one the project page uses, `compareProjectOrder` and
-- `compareGoalOrder` in src/lib/writing-projects.ts): projects never placed first (newest first), then the placed ones
-- by sort_position; goals by their project in that order, then by their own sort_position (never placed last), then id.
-- Entries and starting balances are only filtered by the caller, so they get a plain stable order.
CREATE OR REPLACE FUNCTION public.get_profile_writing(p_member_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH shown_projects AS (
    SELECT p.id, p.title, p.sort_position AS order_position, p.created_at AS order_created_at
    FROM public.writing_projects p
    WHERE p.member_id = p_member_id AND p.visibility <> 'private' AND p.deleted_at IS NULL
  ),
  shown_goals AS (
    SELECT g.id, g.project_id, p.title AS project_title, g.goal_type, g.measure, g.target_amount,
           g.start_date, g.end_date, g.habit_period, g.habit_threshold, g.title, g.description,
           p.sort_position AS order_project_position, p.created_at AS order_project_created_at,
           g.sort_position AS order_goal_position
    FROM public.writing_goals g
    JOIN public.writing_projects p ON p.id = g.project_id AND p.deleted_at IS NULL AND p.visibility <> 'private'
    WHERE g.member_id = p_member_id AND g.visibility <> 'private' AND g.archived_at IS NULL AND g.deleted_at IS NULL
  ),
  measured_projects AS (
    SELECT id FROM shown_projects
    UNION
    SELECT project_id FROM shown_goals
  )
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE jsonb_build_object(
    'projects', COALESCE((
      SELECT jsonb_agg(to_jsonb(sp) - 'order_position' - 'order_created_at'
                       ORDER BY sp.order_position ASC NULLS FIRST, sp.order_created_at DESC, sp.id DESC)
      FROM shown_projects sp
    ), '[]'::jsonb),
    'goals', COALESCE((
      SELECT jsonb_agg(to_jsonb(sg) - 'order_project_position' - 'order_project_created_at' - 'order_goal_position'
                       ORDER BY sg.order_project_position ASC NULLS FIRST, sg.order_project_created_at DESC,
                                sg.project_id DESC, sg.order_goal_position ASC NULLS LAST, sg.id ASC)
      FROM shown_goals sg
    ), '[]'::jsonb),
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'project_id', e.project_id, 'entry_date', e.entry_date, 'measure', e.measure,
        'mode', e.mode, 'amount', e.amount, 'created_at', e.created_at)
        ORDER BY e.project_id, e.entry_date, e.created_at, e.id)
      FROM public.writing_progress_entries e
      WHERE e.member_id = p_member_id AND e.deleted_at IS NULL
        AND e.project_id IN (SELECT id FROM measured_projects)
    ), '[]'::jsonb),
    'starting_balances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('project_id', b.project_id, 'measure', b.measure, 'amount', b.amount)
                       ORDER BY b.project_id, b.measure)
      FROM public.writing_project_starting_balances b
      WHERE b.member_id = p_member_id AND b.project_id IN (SELECT id FROM measured_projects)
    ), '[]'::jsonb)
  ) END;
$function$;
