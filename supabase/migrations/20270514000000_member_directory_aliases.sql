-- The Members page filters in the browser, so it needs every active alias of a directory member, not the ones
-- containing a typed term (search_member_aliases). Same rule as that function: active aliases of members in the
-- directory, signed-in users only; members can't read each other's aliases directly (RLS), so this runs as owner.
CREATE OR REPLACE FUNCTION public.member_directory_aliases()
RETURNS TABLE (member_id text, alias text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.member_id, a.alias
  FROM public.member_name_aliases a
  JOIN public.member_directory d ON d.id = a.member_id
  WHERE a.active
  ORDER BY a.member_id, a.alias
$$;

REVOKE EXECUTE ON FUNCTION public.member_directory_aliases() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_directory_aliases() TO authenticated, service_role;

COMMENT ON FUNCTION public.member_directory_aliases() IS 'Every active name alias of a directory member; powers the Members page search by nickname.';
