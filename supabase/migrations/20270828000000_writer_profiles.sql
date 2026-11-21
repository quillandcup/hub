set lock_timeout = '5s';

-- A writer's public page (docs/product/WRITER_PROFILES.md): opt-in, at a handle the member chooses, shown to anyone and indexed by
-- search engines. This migration is the foundation only: who the page is for (handle, the name shown, photo, bio) and
-- the switch. Nothing about a member's writing is public yet. Expand only: two new tables and one new column.
--
-- Everything is off until the member turns it on (`is_public` defaults to false), and nothing here is readable without a
-- sign-in: the public page reads through the service role, from the repository, and returns only the fields meant to be
-- public (lib/data/writer-profiles.ts). Tier 2 ids: never in a URL (the address is the handle).

-- 1. Which of a member's own names may be shown. `member_name_aliases` mixes names the member typed with names we matched
-- from Zoom and Slack (typos, legal names), and members can read and switch their own rows, so only a name the member added
-- themselves can be marked public, and the database refuses the flag on any other (a member cannot flip it by hand).
ALTER TABLE public.member_name_aliases ADD COLUMN is_public boolean NOT NULL DEFAULT false;
ALTER TABLE public.member_name_aliases
  ADD CONSTRAINT member_name_aliases_public_only_member_added CHECK (NOT is_public OR source = 'member') NOT VALID;
ALTER TABLE public.member_name_aliases VALIDATE CONSTRAINT member_name_aliases_public_only_member_added;
COMMENT ON COLUMN public.member_name_aliases.is_public IS
  'The member allows this name to be shown on their public writer page as a pen name. Default false; only a name the member added themselves (source = member) can be public.';

-- 2. The page. One live row per member, created when they pick a handle.
CREATE TABLE public.writer_profiles (
  id text PRIMARY KEY DEFAULT public.new_id('wpage'),
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  -- Lowercase letters and digits with single hyphens inside. The length limits are in app.config.ts (`writerProfiles`),
  -- checked by the app before it calls `set_writer_handle`.
  handle text NOT NULL CHECK (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(handle) <= 63),
  -- The switch. Nothing about the page is public until it is true.
  is_public boolean NOT NULL DEFAULT false,
  -- The name shown: NULL is the member's display name (never the legal name); otherwise one of their public pen names.
  -- member_name_aliases still has uuid ids (Tier 2, docs/decisions/SHORT_IDS_PLAN.md phase 2): this column follows it when it converts.
  public_name_alias_id uuid REFERENCES public.member_name_aliases(id) ON DELETE SET NULL,
  -- Their photo is shown only when this is true.
  show_photo boolean NOT NULL DEFAULT false,
  -- Plain text the member wrote for the page (the length limit is in app.config.ts).
  public_bio text CHECK (public_bio IS NULL OR char_length(public_bio) <= 5000),
  -- The first time the page was turned on.
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- One live page per member and one live page per address, whatever the case.
CREATE UNIQUE INDEX writer_profiles_member_live ON public.writer_profiles (member_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX writer_profiles_handle_live ON public.writer_profiles (lower(handle)) WHERE deleted_at IS NULL;
-- The sitemap lists public pages in a stable order.
CREATE INDEX writer_profiles_public_idx ON public.writer_profiles (id) WHERE is_public AND deleted_at IS NULL;
CREATE INDEX writer_profiles_alias_idx ON public.writer_profiles (public_name_alias_id) WHERE public_name_alias_id IS NOT NULL;

-- 3. Handles a member used to have. A renamed handle keeps redirecting to the current one, and stays reserved for its
-- previous owner until `reserved_until` (the period is `writerProfiles.handleReservationDays` in app.config.ts, which the
-- app passes to `set_writer_handle`). Someone else can take it only after that, and then the redirect goes away.
CREATE TABLE public.writer_profile_handles (
  id text PRIMARY KEY DEFAULT public.new_id('whand'),
  handle text NOT NULL CHECK (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(handle) <= 63),
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  released_at timestamptz NOT NULL,
  reserved_until timestamptz NOT NULL
);
CREATE UNIQUE INDEX writer_profile_handles_handle ON public.writer_profile_handles (lower(handle));
CREATE INDEX writer_profile_handles_member_idx ON public.writer_profile_handles (member_id);

COMMENT ON TABLE public.writer_profiles IS
  'LOCAL: A member''s public writer page (opt-in, off by default): handle, the name shown (display name or a public pen name), photo switch and bio. Read for visitors only through the service role by the repository. [id prefix: wpage_]';
COMMENT ON TABLE public.writer_profile_handles IS
  'LOCAL: Handles a member used to have: the old address redirects to the current one and stays reserved for them until reserved_until. [id prefix: whand_]';

-- 4. Row-level security: the member reads and changes their own page, an admin reads and changes any (sudo, support).
-- No anon policy or grant. A member changes only the page's own settings (column grants below); the handle is written
-- only by `set_writer_handle`, which the server calls with the service role after checking reserved words.
ALTER TABLE public.writer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.writer_profile_handles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own writer page, admins read all" ON public.writer_profiles
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Members change their own writer page, admins change any" ON public.writer_profiles
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

CREATE POLICY "Members read their own old handles, admins read all" ON public.writer_profile_handles
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

REVOKE ALL ON public.writer_profiles, public.writer_profile_handles FROM anon, authenticated;
GRANT SELECT ON public.writer_profiles, public.writer_profile_handles TO authenticated;
GRANT UPDATE (is_public, public_name_alias_id, show_photo, public_bio) ON public.writer_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.writer_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.writer_profile_handles TO service_role;

-- 5. Keep the row honest on every write: the name shown must be a public pen name of the same member (so a page can never
-- be pointed at someone else's name or at a matching-only alias), the first time it goes public is remembered, and
-- updated_at moves.
CREATE FUNCTION public.writer_profiles_before_write() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.public_name_alias_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.public_name_alias_id IS DISTINCT FROM OLD.public_name_alias_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.member_name_aliases a
      WHERE a.id = NEW.public_name_alias_id AND a.member_id = NEW.member_id AND a.is_public AND a.active AND a.source = 'member'
    ) THEN
      RAISE EXCEPTION 'public_name_not_allowed' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.is_public AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER writer_profiles_before_write
  BEFORE INSERT OR UPDATE ON public.writer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.writer_profiles_before_write();

-- 6. Audit: turning the page on or off, the name shown, the photo switch and the bio are entries as the member (the bio is
-- logged as changed, never with its text). A handle change is not audited here: it is written by the server with the
-- service role (which would read as "system"), so the server records it as the member's own activity instead.
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.writer_profiles
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - 'updated_at' - 'handle' - 'published_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at' - 'handle' - 'published_at')
  )
  EXECUTE FUNCTION public.audit_row_change('writer_profile', 'id', 'public_bio');

-- 7. Claim or change the handle, as one step. Returns what happened:
--   created    the member had no page; it now exists (off) at this handle
--   changed    their page moved to this handle; the old one redirects and is reserved for them
--   unchanged  it already was their handle
--   taken      another page has it now
--   reserved   it was someone else's recently and is still held for them
-- The member's own old handle can be taken back at any time. `p_now` comes from the caller (lib/clock), so the reservation
-- can be tested at a chosen time. Service role only: the server checks who is asking and the reserved words first.
CREATE FUNCTION public.set_writer_handle(p_member_id text, p_handle text, p_reserve_days integer, p_now timestamptz)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cur public.writer_profiles%ROWTYPE;
BEGIN
  IF p_handle !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(p_handle) > 63 THEN
    RAISE EXCEPTION 'invalid_handle' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO cur FROM public.writer_profiles WHERE member_id = p_member_id AND deleted_at IS NULL FOR UPDATE;
  IF FOUND AND cur.handle = p_handle THEN
    RETURN 'unchanged';
  END IF;

  IF EXISTS (SELECT 1 FROM public.writer_profiles WHERE lower(handle) = p_handle AND deleted_at IS NULL) THEN
    RETURN 'taken';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.writer_profile_handles h
    WHERE lower(h.handle) = p_handle AND h.member_id <> p_member_id AND h.reserved_until > p_now
  ) THEN
    RETURN 'reserved';
  END IF;

  -- Taking back one of their own old handles, or one whose hold has run out, ends its redirect.
  DELETE FROM public.writer_profile_handles WHERE lower(handle) = p_handle;

  IF cur.id IS NULL THEN
    INSERT INTO public.writer_profiles (member_id, handle) VALUES (p_member_id, p_handle);
    RETURN 'created';
  END IF;

  UPDATE public.writer_profiles SET handle = p_handle WHERE id = cur.id;
  INSERT INTO public.writer_profile_handles (handle, member_id, released_at, reserved_until)
  VALUES (cur.handle, p_member_id, p_now, p_now + make_interval(days => p_reserve_days));
  RETURN 'changed';
EXCEPTION
  WHEN unique_violation THEN
    -- Two people claimed the same handle at once: the other one got it.
    RETURN 'taken';
END;
$$;

REVOKE ALL ON FUNCTION public.set_writer_handle(text, text, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_writer_handle(text, text, integer, timestamptz) TO service_role;
COMMENT ON FUNCTION public.set_writer_handle(text, text, integer, timestamptz) IS
  'Claims or changes a member''s writer page handle (created, changed, unchanged, taken, reserved), keeping the old handle as a redirect reserved for them. Service role only.';

-- A removal request (supabase/tests/database/member_data_handling.test.sql keeps this list complete): the page is the member's own
-- public work in their own words, and an old address means nothing without it, so both go with them.
INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('writer_profiles', 'member_id', 'delete', 'their own public page, with a bio in their own words'),
  ('writer_profile_handles', 'member_id', 'delete', 'the old addresses of their page, which goes with it');
