-- A goal on the profile shows its project's title and progress, so a goal is on the profile only if
-- its project is (and projects now start out on the profile).
--   1. Projects behind a goal that is shown today become shown: a goal on a private project showed the
--      project's title and progress anyway, and most of these were the new-goal form's pre-ticked box.
--      Projects with no shown goal keep what they had.
--   2. New projects start on the profile (the column default); existing ones are not changed.
--   3. The database keeps the two together: a goal cannot be shown while its project is private, and
--      hiding a project hides its goals, so showing the project again does not bring them back.
--   4. get_profile_writing lists goals only on shown projects, as a second line of defence.

set lock_timeout = '5s';

UPDATE public.writing_projects p
SET show_on_profile = true
WHERE NOT p.show_on_profile
  AND p.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.writing_goals g
    WHERE g.project_id = p.id AND g.show_on_profile AND g.archived_at IS NULL AND g.deleted_at IS NULL
  );

ALTER TABLE public.writing_projects ALTER COLUMN show_on_profile SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.writing_goal_follow_project_visibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.show_on_profile AND NOT EXISTS (
    SELECT 1 FROM public.writing_projects p WHERE p.id = NEW.project_id AND p.show_on_profile
  ) THEN
    NEW.show_on_profile := false;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER writing_goals_follow_project_visibility
  BEFORE INSERT OR UPDATE OF show_on_profile, project_id ON public.writing_goals
  FOR EACH ROW EXECUTE FUNCTION public.writing_goal_follow_project_visibility();

CREATE OR REPLACE FUNCTION public.writing_project_hides_goals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.writing_goals SET show_on_profile = false
  WHERE project_id = NEW.id AND show_on_profile;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER writing_projects_hide_goals
  AFTER UPDATE OF show_on_profile ON public.writing_projects
  FOR EACH ROW WHEN (OLD.show_on_profile AND NOT NEW.show_on_profile)
  EXECUTE FUNCTION public.writing_project_hides_goals();

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
    JOIN public.writing_projects p ON p.id = g.project_id AND p.deleted_at IS NULL AND p.show_on_profile
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
