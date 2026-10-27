-- Lets member search match a member's nicknames and pen names (their active name aliases). Members can
-- read only their own aliases (RLS), so this runs as the owner, but it reveals nothing beyond who matched
-- and what the matching alias is, only for members already in the member directory, only active aliases,
-- and only to signed-in users. strpos, not LIKE: what was typed is never a pattern.
CREATE OR REPLACE FUNCTION public.search_member_aliases(p_term text)
RETURNS TABLE (member_id text, alias text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.member_id, a.alias
  FROM public.member_name_aliases a
  JOIN public.member_directory d ON d.id = a.member_id
  WHERE a.active
    AND length(btrim(p_term)) > 0
    AND strpos(lower(a.alias), lower(btrim(p_term))) > 0
  ORDER BY a.alias
  LIMIT 200
$$;

REVOKE EXECUTE ON FUNCTION public.search_member_aliases(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_member_aliases(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.search_member_aliases(text) IS 'Active name aliases containing the term, for directory members; powers member search by nickname.';
