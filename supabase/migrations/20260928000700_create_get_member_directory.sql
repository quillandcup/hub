-- Read path for the member directory (/members): current Hedgies with their public profile
-- fields, "Ask me about ..." topics, and the titles of what they're working on.
--
-- Why a function: "current" needs members.status, and "working on" needs writing_projects,
-- both readable only by their owner (and admins). Like get_profile_writing, this returns just
-- the public subset -- no status column, no emails, and only titles of projects the member
-- opted onto their profile ("Show on my profile") that aren't archived, complete or abandoned.
--
-- Current = status 'active' or 'on_hiatus' (a member on hiatus is still a Hedgie; the status
-- itself isn't returned). Ordered by id so callers can page through it with .range().

CREATE OR REPLACE FUNCTION public.get_member_directory()
RETURNS TABLE (
  id UUID,
  name TEXT,
  display_name TEXT,
  photo_url TEXT,
  bio TEXT,
  first_joined_at DATE,
  projects TEXT[],
  topics TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    d.id, d.name, d.display_name, d.photo_url, d.bio, d.first_joined_at,
    COALESCE((
      SELECT array_agg(p.title ORDER BY p.created_at)
      FROM public.writing_projects p
      WHERE p.member_id = d.id
        AND p.show_on_profile
        AND p.archived_at IS NULL
        AND p.phase NOT IN ('complete', 'abandoned')
    ), '{}'::TEXT[]) AS projects,
    COALESCE(a.topics, '{}'::TEXT[]) AS topics
  FROM public.members m
  JOIN public.member_directory d ON d.id = m.id
  LEFT JOIN public.member_ask_me_about a ON a.member_id = m.id
  WHERE m.status IN ('active', 'on_hiatus')
    AND (SELECT auth.uid()) IS NOT NULL
  ORDER BY d.id;
$$;

COMMENT ON FUNCTION public.get_member_directory() IS
  'Member directory: current (active / on hiatus) members'' public profile fields, ask-me-about topics, and titles of opted-in, in-progress writing projects. No status, email or private project data. Any signed-in member may call it.';

REVOKE EXECUTE ON FUNCTION public.get_member_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_directory() TO authenticated, service_role;
