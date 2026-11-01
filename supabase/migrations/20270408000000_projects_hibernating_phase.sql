-- The "abandoned" project status is now "hibernating": it is what members see, and nobody had picked
-- the old one (no production row has it). One step: the check accepts only the new value. During the
-- minutes of a deploy the code still running has an "Abandoned" option whose save the check would
-- refuse; the owner accepted that instead of the two-step (expand, then contract) route.

set lock_timeout = '5s';

-- Approved ban-drop-constraint ignore: the check is only replaced, in the statements below.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.writing_projects DROP CONSTRAINT writing_projects_phase_check;

UPDATE public.writing_projects SET phase = 'hibernating' WHERE phase = 'abandoned';

ALTER TABLE public.writing_projects ADD CONSTRAINT writing_projects_phase_check
  CHECK (phase IN ('planning', 'outlining', 'drafting', 'revising', 'on_hold', 'complete', 'published', 'hibernating'));

-- The directory's "working on" leaves out finished and hibernating projects.
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
        AND p.phase NOT IN ('complete', 'hibernating')
    ), '{}'::TEXT[]) AS projects,
    COALESCE(a.topics, '{}'::TEXT[]) AS topics
  FROM public.members m
  JOIN public.member_directory d ON d.id = m.id
  LEFT JOIN public.member_ask_me_about a ON a.member_id = m.id
  WHERE m.status IN ('active', 'on_hiatus')
    AND (SELECT auth.uid()) IS NOT NULL
  ORDER BY d.id;
$function$;
