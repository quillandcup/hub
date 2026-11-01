-- Names a member adds for themselves (Settings → Identity → Pen Names & Zoom/Slack Names) have to be
-- checked against everyone else's, or one member's alias quietly takes over another's attendance:
-- the matcher tries aliases before full names (lib/member-matching.ts), so an alias equal to another
-- member's real name wins over that member, and the table's UNIQUE (alias) only catches the same
-- text, not "Ada  Example" vs "ada example" or "Ada Example." Names compare the way the matcher's
-- normalizeName does (lowercase, letters and digits, single spaces); a name with none (non-Latin
-- scripts) compares lowercased and trimmed instead.
--
-- Members can't read each other's aliases (RLS), so the server action asks this from the service role.

CREATE OR REPLACE FUNCTION public.name_alias_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    nullif(btrim(regexp_replace(regexp_replace(lower(p_name), '[^a-z0-9\s]', '', 'g'), '\s+', ' ', 'g')), ''),
    lower(btrim(p_name))
  );
$$;

-- Why `p_alias` can't be added for `p_member_id`, or NULL when it can:
--   own           the member already has it switched on
--   own_inactive  the member has it, switched off
--   other_alias   another member has it as an alias (on or off)
--   other_name    it is another member's real name
CREATE OR REPLACE FUNCTION public.name_alias_conflict(p_member_id TEXT, p_alias TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.member_name_aliases a
      WHERE a.member_id = p_member_id AND a.active AND public.name_alias_key(a.alias) = public.name_alias_key(p_alias)
    ) THEN 'own'
    WHEN EXISTS (
      SELECT 1 FROM public.member_name_aliases a
      WHERE a.member_id = p_member_id AND public.name_alias_key(a.alias) = public.name_alias_key(p_alias)
    ) THEN 'own_inactive'
    WHEN EXISTS (
      SELECT 1 FROM public.member_name_aliases a
      WHERE a.member_id <> p_member_id AND public.name_alias_key(a.alias) = public.name_alias_key(p_alias)
    ) THEN 'other_alias'
    WHEN EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id <> p_member_id AND public.name_alias_key(m.name) = public.name_alias_key(p_alias)
    ) THEN 'other_name'
  END;
$$;

REVOKE ALL ON FUNCTION public.name_alias_key(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.name_alias_key(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.name_alias_conflict(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.name_alias_conflict(TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.name_alias_conflict(TEXT, TEXT) IS 'Why a member can''t add a name as their own alias (own, own_inactive, other_alias, other_name), or NULL. Service role only: it looks across members.';
