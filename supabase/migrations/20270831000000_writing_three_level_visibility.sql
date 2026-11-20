-- Three levels of visibility for a writing project and a writing goal, replacing the on/off "show on my profile".
--   private    only the writer
--   community  signed-in members (what "show on my profile" has always meant)
--   public     open to the internet (nothing reads this yet: a later change adds the public profile)
--
-- This is the EXPAND step. show_on_profile stays, and stays correct, so the code live during the deploy and every
-- existing reader keeps working. The two columns are kept together by triggers, whichever one a write names:
--   - writing `visibility` sets show_on_profile to (visibility <> 'private');
--   - writing `show_on_profile` alone moves visibility to private (false) or, when it was private, to community (true);
--   - a new row naming only one of the two (the other left at its default) follows the one that was named.
-- A goal can never be more visible than its project: a goal row is clamped to its project's level when it is written, and
-- read as the lower of the two (get_profile_writing needs both to be shown). Lowering a project does NOT rewrite its goals'
-- own setting, so raising the project again brings the same goals back (20270523000000 made that choice).
-- The CONTRACT step (dropping show_on_profile) is a later change: docs/TODO.md, "Drop show_on_profile".
--
-- Backfill: show_on_profile true -> community, false -> private. Nothing becomes public.

set lock_timeout = '5s';

ALTER TABLE public.writing_projects ADD COLUMN visibility text NOT NULL DEFAULT 'community';
ALTER TABLE public.writing_goals ADD COLUMN visibility text NOT NULL DEFAULT 'private';

UPDATE public.writing_projects SET visibility = 'private' WHERE NOT show_on_profile;
UPDATE public.writing_goals SET visibility = 'community' WHERE show_on_profile;
-- A goal's own setting is copied as it is, even on a private project: hiding a project keeps its goals' flags
-- (20270523000000), and the profile already needs both to be on.

ALTER TABLE public.writing_projects
  ADD CONSTRAINT writing_projects_visibility_check CHECK (visibility IN ('private', 'community', 'public')) NOT VALID;
ALTER TABLE public.writing_projects VALIDATE CONSTRAINT writing_projects_visibility_check;
ALTER TABLE public.writing_goals
  ADD CONSTRAINT writing_goals_visibility_check CHECK (visibility IN ('private', 'community', 'public')) NOT VALID;
ALTER TABLE public.writing_goals VALIDATE CONSTRAINT writing_goals_visibility_check;

COMMENT ON COLUMN public.writing_projects.visibility IS
  'Who can see the project: private (only the writer), community (signed-in members) or public (the internet). show_on_profile is kept equal to (visibility <> ''private'') until it is dropped.';
COMMENT ON COLUMN public.writing_goals.visibility IS
  'Who can see the goal, never more than its project: private, community or public. show_on_profile is kept equal to (visibility <> ''private'') until it is dropped.';

-- private < community < public
CREATE FUNCTION public.writing_visibility_rank(p_visibility text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT CASE p_visibility WHEN 'public' THEN 2 WHEN 'community' THEN 1 ELSE 0 END;
$function$;

-- Projects: keep visibility and show_on_profile together.
CREATE FUNCTION public.writing_project_sync_visibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Both columns have a default (community, shown): a row that changed only show_on_profile still has the
    -- default visibility, so the one that differs from its default is the one that was named.
    IF NEW.visibility = 'community' AND NOT NEW.show_on_profile THEN
      NEW.visibility := 'private';
    ELSE
      NEW.show_on_profile := NEW.visibility <> 'private';
    END IF;
  ELSIF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    NEW.show_on_profile := NEW.visibility <> 'private';
  ELSIF NEW.show_on_profile IS DISTINCT FROM OLD.show_on_profile THEN
    NEW.visibility := CASE
      WHEN NOT NEW.show_on_profile THEN 'private'
      WHEN OLD.visibility = 'private' THEN 'community'
      ELSE OLD.visibility
    END;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER writing_projects_sync_visibility
  BEFORE INSERT OR UPDATE OF visibility, show_on_profile ON public.writing_projects
  FOR EACH ROW EXECUTE FUNCTION public.writing_project_sync_visibility();

-- Goals: keep the two together, then never more visible than the project. (Replaces the function from
-- 20270521000000_goals_follow_project_visibility, which only handled the on/off flag.)
CREATE OR REPLACE FUNCTION public.writing_goal_follow_project_visibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  project_level text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The defaults are private and not shown: the one that differs from its default is the one that was named.
    IF NEW.visibility = 'private' AND NEW.show_on_profile THEN
      NEW.visibility := 'community';
    ELSE
      NEW.show_on_profile := NEW.visibility <> 'private';
    END IF;
  ELSIF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    NEW.show_on_profile := NEW.visibility <> 'private';
  ELSIF NEW.show_on_profile IS DISTINCT FROM OLD.show_on_profile THEN
    NEW.visibility := CASE
      WHEN NOT NEW.show_on_profile THEN 'private'
      WHEN OLD.visibility = 'private' THEN 'community'
      ELSE OLD.visibility
    END;
  END IF;

  SELECT p.visibility INTO project_level FROM public.writing_projects p WHERE p.id = NEW.project_id;
  IF project_level IS NOT NULL
     AND public.writing_visibility_rank(NEW.visibility) > public.writing_visibility_rank(project_level) THEN
    NEW.visibility := project_level;
    NEW.show_on_profile := NEW.visibility <> 'private';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER writing_goals_follow_project_visibility ON public.writing_goals;
CREATE TRIGGER writing_goals_follow_project_visibility
  BEFORE INSERT OR UPDATE OF visibility, show_on_profile, project_id ON public.writing_goals
  FOR EACH ROW EXECUTE FUNCTION public.writing_goal_follow_project_visibility();

-- The profile lists what is not private (community or public): the same set the members see today. Nothing here
-- hands anything to a signed-out caller; that stays true until the public profile ships.
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
    WHERE p.member_id = p_member_id AND p.visibility <> 'private' AND p.deleted_at IS NULL
  ),
  shown_goals AS (
    SELECT g.id, g.project_id, p.title AS project_title, g.goal_type, g.measure, g.target_amount,
           g.start_date, g.end_date, g.habit_period, g.habit_threshold, g.title, g.description
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

-- The table grants cover the new columns (they are table-level). The helpers are only called from the triggers above,
-- which run as the writer, so signed-in members and the service role keep EXECUTE; a signed-out caller has none.
REVOKE ALL ON FUNCTION public.writing_visibility_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.writing_visibility_rank(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.writing_project_sync_visibility() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.writing_project_sync_visibility() TO authenticated, service_role;
