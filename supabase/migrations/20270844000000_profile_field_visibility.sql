set lock_timeout = '5s';

-- Who can see each item on a member's profile: private (only the member), community (signed-in members, today's
-- behavior) or public (the open internet, on the member's writer page once that page is on).
--
-- Expand step only: new columns with defaults, a new function, a trigger and a policy swap. Nothing is dropped or
-- retyped, and the old code that is live during a deploy keeps working (every item stays at "community", which is what
-- it did). `writer_profiles.show_photo` stays where it is, no longer read; dropping it is the contract step
-- (docs/TODO.md, "Drop writer_profiles.show_photo once the photo level is the only reader").
--
-- Where each level is stored:
--   * member_profile_overrides: bio, photo, Instagram, Facebook and X (Local layer; a member writes only their own row,
--     an admin any, which covers sudo). A row can exist with every text field NULL ("follow Kajabi") and only a level set.
--   * member_ask_me_about: the topics. They are never on the web page, so only private and community are allowed.
--
-- Who honors "private": the member directory (every member-facing page and search reads it) holds NULL for a private
-- item, so no member or admin sees it there; the topics are hidden by the policy below and by member_ask_me_about_shown,
-- the function member-facing reads use. A member's own Settings read their own row and `members`, which are unchanged.

ALTER TABLE public.member_profile_overrides
  ADD COLUMN bio_visibility text NOT NULL DEFAULT 'community'
    CONSTRAINT member_profile_overrides_bio_visibility_check CHECK (bio_visibility IN ('private', 'community', 'public')),
  ADD COLUMN photo_visibility text NOT NULL DEFAULT 'community'
    CONSTRAINT member_profile_overrides_photo_visibility_check CHECK (photo_visibility IN ('private', 'community', 'public')),
  ADD COLUMN instagram_visibility text NOT NULL DEFAULT 'community'
    CONSTRAINT member_profile_overrides_instagram_visibility_check CHECK (instagram_visibility IN ('private', 'community', 'public')),
  ADD COLUMN facebook_visibility text NOT NULL DEFAULT 'community'
    CONSTRAINT member_profile_overrides_facebook_visibility_check CHECK (facebook_visibility IN ('private', 'community', 'public')),
  ADD COLUMN twitter_visibility text NOT NULL DEFAULT 'community'
    CONSTRAINT member_profile_overrides_twitter_visibility_check CHECK (twitter_visibility IN ('private', 'community', 'public'));

COMMENT ON COLUMN public.member_profile_overrides.bio_visibility IS
  'Who can see the bio: private (only the member), community (signed-in members), public (the open web, on the writer page, when the member has no separate public bio). Default community = what it was before the column existed.';
COMMENT ON COLUMN public.member_profile_overrides.photo_visibility IS
  'Who can see the profile photo: private, community or public (on the writer page). Replaces writer_profiles.show_photo, which is no longer read.';
COMMENT ON COLUMN public.member_profile_overrides.instagram_visibility IS 'Who can see the Instagram link: private, community or public (on the writer page).';
COMMENT ON COLUMN public.member_profile_overrides.facebook_visibility IS 'Who can see the Facebook link: private, community or public (on the writer page).';
COMMENT ON COLUMN public.member_profile_overrides.twitter_visibility IS 'Who can see the X link: private, community or public (on the writer page).';

ALTER TABLE public.member_ask_me_about
  ADD COLUMN visibility text NOT NULL DEFAULT 'community'
    CONSTRAINT member_ask_me_about_visibility_check CHECK (visibility IN ('private', 'community'));

COMMENT ON COLUMN public.member_ask_me_about.visibility IS
  'Who can see the topics: private (only the member) or community (signed-in members). Never public: the writer page does not show them.';

-- A photo that was shown on the writer page keeps being shown: its switch becomes the photo's public level.
INSERT INTO public.member_profile_overrides (member_id, photo_visibility)
SELECT member_id, 'public' FROM public.writer_profiles WHERE show_photo AND deleted_at IS NULL
ON CONFLICT (member_id) DO UPDATE SET photo_visibility = 'public';

-- 1. The member directory leaves a private item out. One function builds a member's row from members and their levels;
-- the members trigger and the new overrides trigger both call it, so the two can never disagree.
CREATE OR REPLACE FUNCTION public.refresh_member_directory(p_member_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.member_directory AS d (
    id, name, display_name, photo_url, bio, instagram_url, facebook_url, twitter_url,
    joined_at, first_joined_at, most_recent_joined_at, total_active_months
  )
  SELECT m.id, m.name, m.display_name,
         CASE WHEN o.photo_visibility = 'private' THEN NULL ELSE m.photo_url END,
         CASE WHEN o.bio_visibility = 'private' THEN NULL ELSE m.bio END,
         CASE WHEN o.instagram_visibility = 'private' THEN NULL ELSE m.instagram_url END,
         CASE WHEN o.facebook_visibility = 'private' THEN NULL ELSE m.facebook_url END,
         CASE WHEN o.twitter_visibility = 'private' THEN NULL ELSE m.twitter_url END,
         m.joined_at, m.first_joined_at, m.most_recent_joined_at, m.total_active_months
  FROM public.members m
  LEFT JOIN public.member_profile_overrides o ON o.member_id = m.id
  WHERE m.id = p_member_id
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    display_name = EXCLUDED.display_name,
    photo_url = EXCLUDED.photo_url,
    bio = EXCLUDED.bio,
    instagram_url = EXCLUDED.instagram_url,
    facebook_url = EXCLUDED.facebook_url,
    twitter_url = EXCLUDED.twitter_url,
    joined_at = EXCLUDED.joined_at,
    first_joined_at = EXCLUDED.first_joined_at,
    most_recent_joined_at = EXCLUDED.most_recent_joined_at,
    total_active_months = EXCLUDED.total_active_months
  WHERE (d.name, d.display_name, d.photo_url, d.bio, d.instagram_url, d.facebook_url,
         d.twitter_url, d.joined_at, d.first_joined_at, d.most_recent_joined_at,
         d.total_active_months)
        IS DISTINCT FROM
        (EXCLUDED.name, EXCLUDED.display_name, EXCLUDED.photo_url, EXCLUDED.bio,
         EXCLUDED.instagram_url, EXCLUDED.facebook_url, EXCLUDED.twitter_url, EXCLUDED.joined_at,
         EXCLUDED.first_joined_at, EXCLUDED.most_recent_joined_at, EXCLUDED.total_active_months);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_member_directory(text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.refresh_member_directory(text) IS
  'Rebuilds one member''s member_directory row from members, leaving out each item whose level in member_profile_overrides is private. Called by the triggers on members and member_profile_overrides.';

CREATE OR REPLACE FUNCTION public.sync_member_directory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.refresh_member_directory(NEW.id);
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_member_directory() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_member_directory_levels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.refresh_member_directory(NEW.member_id);
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_member_directory_levels() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_member_directory_levels_insert ON public.member_profile_overrides;
CREATE TRIGGER sync_member_directory_levels_insert
  AFTER INSERT ON public.member_profile_overrides
  FOR EACH ROW EXECUTE FUNCTION public.sync_member_directory_levels();

DROP TRIGGER IF EXISTS sync_member_directory_levels_update ON public.member_profile_overrides;
CREATE TRIGGER sync_member_directory_levels_update
  AFTER UPDATE OF bio_visibility, photo_visibility, instagram_visibility, facebook_visibility, twitter_visibility
  ON public.member_profile_overrides
  FOR EACH ROW EXECUTE FUNCTION public.sync_member_directory_levels();

-- Members whose photo was just made public above have a new row: nothing to hide, but run the same rebuild for any row
-- that is private (none yet), so a re-run of this file repairs drift.
SELECT public.refresh_member_directory(member_id) FROM public.member_profile_overrides
WHERE 'private' IN (bio_visibility, photo_visibility, instagram_visibility, facebook_visibility, twitter_visibility);

-- 2. Audit: a change of level is one entry as the member (or as the admin acting for them), with the old and new level.
-- The text fields on the same row are redacted, so the log never holds a bio or a link.
CREATE TRIGGER audit_profile_visibility_update
  AFTER UPDATE ON public.member_profile_overrides
  FOR EACH ROW WHEN (
    (OLD.bio_visibility, OLD.photo_visibility, OLD.instagram_visibility, OLD.facebook_visibility, OLD.twitter_visibility)
    IS DISTINCT FROM
    (NEW.bio_visibility, NEW.photo_visibility, NEW.instagram_visibility, NEW.facebook_visibility, NEW.twitter_visibility)
  )
  EXECUTE FUNCTION public.audit_row_change('member_profile_visibility', 'member_id', 'bio,instagram_url,facebook_url,twitter_url,photo_path');

CREATE TRIGGER audit_profile_visibility_insert
  AFTER INSERT ON public.member_profile_overrides
  FOR EACH ROW WHEN (
    NEW.bio_visibility <> 'community' OR NEW.photo_visibility <> 'community' OR NEW.instagram_visibility <> 'community'
    OR NEW.facebook_visibility <> 'community' OR NEW.twitter_visibility <> 'community'
  )
  EXECUTE FUNCTION public.audit_row_change('member_profile_visibility', 'member_id', 'bio,instagram_url,facebook_url,twitter_url,photo_path');

-- 3. "Ask me about": other members no longer read a private list from the table, and the function below is what
-- member-facing reads use (it also hides it from an admin who is not the owner).
DROP POLICY IF EXISTS "Authenticated users can read ask-me-about topics" ON public.member_ask_me_about;
DROP POLICY IF EXISTS "Members read shared topics and their own, admins all" ON public.member_ask_me_about;
CREATE POLICY "Members read shared topics and their own, admins all" ON public.member_ask_me_about
  FOR SELECT TO authenticated
  USING (visibility <> 'private' OR member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

CREATE OR REPLACE FUNCTION public.member_ask_me_about_shown(p_member_id text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT a.topics FROM public.member_ask_me_about a
    WHERE a.member_id = p_member_id
      AND (a.visibility <> 'private' OR a.member_id = (SELECT public.current_member_id()))
  ), '{}'::text[]);
$$;

REVOKE EXECUTE ON FUNCTION public.member_ask_me_about_shown(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_ask_me_about_shown(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.member_ask_me_about_shown(text) IS
  'The "Ask me about" topics the caller may see for a member: all of them when the list is shared with members or the caller is its owner, none when it is private (an admin who is not the owner included).';

-- The Members page lists topics too (latest definition: 20270408000000), now leaving out a private list.
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
    COALESCE(
      CASE WHEN a.visibility <> 'private' OR a.member_id = (SELECT public.current_member_id()) THEN a.topics END,
      '{}'::TEXT[]
    ) AS topics
  FROM public.members m
  JOIN public.member_directory d ON d.id = m.id
  LEFT JOIN public.member_ask_me_about a ON a.member_id = m.id
  WHERE m.status IN ('active', 'on_hiatus')
    AND (SELECT auth.uid()) IS NOT NULL
  ORDER BY d.id;
$function$;

-- 4. A Big Sister match shows the other person's photo: from the directory, so a private photo stays private (latest
-- definition: 20261215000000).
CREATE OR REPLACE FUNCTION public.my_mentorships(p_member_id text)
 RETURNS TABLE(mentorship_id uuid, viewer_role text, other_member_id text, other_name text, other_display_name text, other_photo_url text, started_on date, trial_ends_on date, kind text, outcome_note text, other_status text, other_first_joined_at date, other_most_recent_joined_at date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    m.id,
    CASE WHEN m.mentor_member_id = p_member_id THEN 'big_sister' ELSE 'new_member' END,
    o.id, o.name, o.display_name, d.photo_url,
    m.started_on, m.trial_ends_on, m.kind,
    CASE WHEN m.mentor_member_id = p_member_id THEN m.outcome_note END,
    CASE WHEN m.mentor_member_id = p_member_id THEN o.status END,
    CASE WHEN m.mentor_member_id = p_member_id THEN o.first_joined_at END,
    CASE WHEN m.mentor_member_id = p_member_id THEN o.most_recent_joined_at END
  FROM mentorships m
  JOIN members o ON o.id = CASE WHEN m.mentor_member_id = p_member_id THEN m.new_member_id ELSE m.mentor_member_id END
  LEFT JOIN member_directory d ON d.id = o.id
  WHERE m.status = 'matched'
    AND (m.mentor_member_id = p_member_id OR m.new_member_id = p_member_id)
    AND (p_member_id = current_member_id() OR is_admin())
  ORDER BY m.started_on DESC;
$function$;
