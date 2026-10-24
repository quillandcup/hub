-- name_alias_conflict (20261223000000) said only *why* a name can't be added. The admin paths that
-- create aliases (resolve an ambiguous Zoom name, the member editor, bulk apply) also need *whose* it
-- is, to tell the admin who holds it. Same checks and priority, now returning one row (none when the
-- name is free): kind, and for other_alias / other_name the other member's id and name.
--
-- Members never see the other member's name: the member action turns a kind into a message.

DROP FUNCTION IF EXISTS public.name_alias_conflict(TEXT, TEXT);

CREATE FUNCTION public.name_alias_conflict(p_member_id TEXT, p_alias TEXT)
RETURNS TABLE (kind TEXT, other_member_id TEXT, other_member_name TEXT)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT c.kind, c.other_member_id, c.other_member_name
  FROM (
    SELECT CASE WHEN a.active THEN 1 ELSE 2 END AS pri,
           CASE WHEN a.active THEN 'own' ELSE 'own_inactive' END AS kind,
           NULL::TEXT AS other_member_id, NULL::TEXT AS other_member_name
    FROM public.member_name_aliases a
    WHERE a.member_id = p_member_id AND public.name_alias_key(a.alias) = public.name_alias_key(p_alias)
    UNION ALL
    SELECT 3, 'other_alias', a.member_id, m.name
    FROM public.member_name_aliases a
    JOIN public.members m ON m.id = a.member_id
    WHERE a.member_id <> p_member_id AND public.name_alias_key(a.alias) = public.name_alias_key(p_alias)
    UNION ALL
    SELECT 4, 'other_name', m.id, m.name
    FROM public.members m
    WHERE m.id <> p_member_id AND public.name_alias_key(m.name) = public.name_alias_key(p_alias)
  ) c
  ORDER BY c.pri
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.name_alias_conflict(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.name_alias_conflict(TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.name_alias_conflict(TEXT, TEXT) IS 'Why a name can''t be added as an alias for a member (own, own_inactive, other_alias, other_name) and whose it is; no row when it is free. Service role only: it looks across members.';
