-- Member-edited public profile fields (Local layer).
--
-- Kajabi's public API can't write a customer's public_bio or socials, so the Hub owns member edits
-- to bio / Facebook / X (product decision: Kajabi's member directory is allowed to drift).
-- /api/process/members prefers a non-empty value here over Kajabi's public_bio /
-- socials.facebook / socials.twitter when it rebuilds members.bio / facebook_url / twitter_url;
-- NULL means "no override, use Kajabi". Instagram is NOT here -- members edit it in Kajabi's
-- "Instagram Handle" contact custom field instead (see lib/kajabi/profile-fields.ts).
--
-- A separate table rather than extra columns on `members` because:
--   * members is Silver: reprocess_members_atomic rewrites its profile columns from Bronze on
--     every run, so the member's own input has to live outside it to survive reprocessing
--     (Local layer, like member_hiatus_history / member_join_date_overrides);
--   * it keeps member-writable data out of the members table's RLS/column grants (which
--     20260926000700 restricts separately), with simple owner-scoped policies here.
-- One row per member (member_id is the primary key); ON DELETE CASCADE because an override means
-- nothing without its member.

CREATE TABLE IF NOT EXISTS public.member_profile_overrides (
  member_id UUID PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  bio TEXT CHECK (bio IS NULL OR (length(btrim(bio)) > 0 AND length(bio) <= 1000)),
  facebook_url TEXT CHECK (facebook_url IS NULL OR (facebook_url ~ '^https?://' AND length(facebook_url) <= 300)),
  twitter_url TEXT CHECK (twitter_url IS NULL OR (twitter_url ~ '^https?://' AND length(twitter_url) <= 300)),
  -- auth user who last saved (the admin's own id during sudo) -- audit only.
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.member_profile_overrides IS
  'Local layer: member-edited bio / Facebook / X. Preferred over Kajabi values by /api/process/members; NULL falls back to Kajabi.';

DROP TRIGGER IF EXISTS update_member_profile_overrides_updated_at ON public.member_profile_overrides;
CREATE TRIGGER update_member_profile_overrides_updated_at
  BEFORE UPDATE ON public.member_profile_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.member_profile_overrides ENABLE ROW LEVEL SECURITY;

-- Members read and write only their own row; admins everything (covers sudo, where the admin's
-- own session does the write). Upsert = INSERT ... ON CONFLICT DO UPDATE, so both are needed.
-- No member DELETE: clearing is an UPDATE to NULL.
DROP POLICY IF EXISTS "Members read own profile overrides, admins read all" ON public.member_profile_overrides;
CREATE POLICY "Members read own profile overrides, admins read all" ON public.member_profile_overrides
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members insert own profile overrides, admins insert any" ON public.member_profile_overrides;
CREATE POLICY "Members insert own profile overrides, admins insert any" ON public.member_profile_overrides
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members update own profile overrides, admins update any" ON public.member_profile_overrides;
CREATE POLICY "Members update own profile overrides, admins update any" ON public.member_profile_overrides
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Admins can delete profile overrides" ON public.member_profile_overrides;
CREATE POLICY "Admins can delete profile overrides" ON public.member_profile_overrides
  FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

REVOKE ALL ON public.member_profile_overrides FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_profile_overrides TO authenticated;
GRANT ALL ON public.member_profile_overrides TO service_role;
