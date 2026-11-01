-- First of two steps to remove writing_projects.archived_at (expand, then contract; see CLAUDE.md,
-- "Migrations: expand, then contract"). Members can't archive a project any more (My Writing lists
-- projects in a past phase apart instead), nothing sets the column, and no production row had it set.
-- This step replaces the two functions that filtered on it, without that filter. The column itself is
-- dropped in a later migration, once the code that stopped reading it is deployed.
-- writing_goals.archived_at ("mark as done") is a different column and stays.

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_member_directory()
 RETURNS TABLE(id text, name text, display_name text, photo_url text, bio text, first_joined_at date, projects text[], topics text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    d.id, d.name, d.display_name, d.photo_url, d.bio, d.first_joined_at,
    COALESCE((
      SELECT array_agg(p.title ORDER BY p.created_at)
      FROM public.writing_projects p
      WHERE p.member_id = d.id
        AND p.show_on_profile
        AND p.deleted_at IS NULL
        AND p.phase NOT IN ('complete', 'abandoned')
    ), '{}'::TEXT[]) AS projects,
    COALESCE(a.topics, '{}'::TEXT[]) AS topics
  FROM public.members m
  JOIN public.member_directory d ON d.id = m.id
  LEFT JOIN public.member_ask_me_about a ON a.member_id = m.id
  WHERE m.status IN ('active', 'on_hiatus')
    AND (SELECT auth.uid()) IS NOT NULL
  ORDER BY d.id;
$function$;

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
      WHERE b.member_id = p_member_id AND b.project_id IN (SELECT id FROM shown_projects)
    ), '[]'::jsonb)
  ) END;
$function$;
