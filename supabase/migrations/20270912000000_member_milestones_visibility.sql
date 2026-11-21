-- Who sees a Finisher milestone, and one consent for the website (docs/product/FINISHERS.md).
--
-- 1. `visibility` replaces `consent_profile`: the same three levels as everywhere (private = lock, community = other members,
--    public = the web). A milestone starts private; confirming one (a member answering a proposal, or adding their own) makes
--    it 'community' unless the member said otherwise, and only a confirmed row can be anything but private (the CHECK), so a
--    staff proposal stays unreadable by others until the member confirms. The two readers below are the only member-facing
--    paths to another member's milestones: they return nothing that is private, whoever calls them (an admin included), and
--    never the row id (Tier 2).
-- 2. `consent_homepage` and `consent_testimonial` become one consent: `consent_testimonial` is the survivor ("Share my story to
--    inspire other writers"); `consent_homepage` is no longer read or written.
--
-- Expand only: a new column, a trigger and two functions. `consent_profile` and `consent_homepage` stay until the contract
-- step (docs/TODO.md, "Finisher record: what is left"). Production had no milestone rows when this was written, so the
-- backfill below moves nothing there; it is here so a database with rows stays right.

set lock_timeout = '5s';

ALTER TABLE public.member_milestones
  ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'community', 'public'));

COMMENT ON COLUMN public.member_milestones.visibility IS
  'Who can see this milestone and the story with it: private (only the member), community (other members) or public (the web, on their writer profile). Only a confirmed row can be anything but private. Replaces consent_profile.';

ALTER TABLE public.member_milestones
  ADD CONSTRAINT member_milestones_visibility_needs_confirmed CHECK (visibility = 'private' OR status = 'confirmed') NOT VALID;
ALTER TABLE public.member_milestones VALIDATE CONSTRAINT member_milestones_visibility_needs_confirmed;

-- Backfill: a profile consent is "other members can see it"; the homepage consent folds into the testimonial one.
UPDATE public.member_milestones SET visibility = 'community' WHERE consent_profile AND status = 'confirmed' AND visibility = 'private';
UPDATE public.member_milestones SET consent_testimonial = true WHERE consent_homepage AND NOT consent_testimonial;

-- A member confirms a milestone (answering a proposal, or "Actually, it is me" after a decline): it starts at 'community',
-- the default for a confirmed milestone, unless the same write names another level. Changing a confirmed row never moves it.
CREATE FUNCTION public.member_milestones_default_visibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status <> 'confirmed' AND OLD.visibility = 'private' AND NEW.visibility = 'private' THEN
    NEW.visibility := 'community';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.member_milestones_default_visibility() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER member_milestones_default_visibility
  BEFORE UPDATE ON public.member_milestones
  FOR EACH ROW EXECUTE FUNCTION public.member_milestones_default_visibility();

-- The member sets the level of their own milestone (the repository only ever writes it on their own live row).
GRANT UPDATE (visibility) ON public.member_milestones TO authenticated;

-- What other members see on a member's profile: confirmed, live and not private, with the work's name (the title the member
-- wrote, or the book's) and the stories, which share the milestone's level. SECURITY DEFINER because the table is readable only
-- by its owner and by staff; the filter is the rule, so a private milestone is not returned to another member, to staff or to
-- anyone else. A signed-in member or the service role only (the grant says the same; the check is the caller check the security
-- guards test looks for). No id is returned.
CREATE FUNCTION public.milestones_shown_to_members(p_member_id text)
RETURNS TABLE (kind text, work_title text, achieved_on date, story_before text, story_after text, visibility text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.kind, coalesce(m.title, b.title), m.achieved_on, m.story_before, m.story_after, m.visibility
  FROM public.member_milestones m
  LEFT JOIN public.member_books b ON b.id = m.book_id AND b.deleted_at IS NULL
  WHERE m.member_id = p_member_id
    AND m.status = 'confirmed'
    AND m.deleted_at IS NULL
    AND m.visibility IN ('community', 'public')
    AND (SELECT auth.role()) IN ('authenticated', 'service_role')
  ORDER BY m.kind DESC, m.created_at, m.id;
$$;

-- What a visitor of the web sees: only the milestones at the globe. Service role only (the page runs with it, after its own
-- checks that the writer profile is on and the member has the feature).
CREATE FUNCTION public.milestones_shown_on_web(p_member_id text)
RETURNS TABLE (kind text, work_title text, achieved_on date, story_before text, story_after text, visibility text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.kind, coalesce(m.title, b.title), m.achieved_on, m.story_before, m.story_after, m.visibility
  FROM public.member_milestones m
  LEFT JOIN public.member_books b ON b.id = m.book_id AND b.deleted_at IS NULL
  WHERE m.member_id = p_member_id
    AND m.status = 'confirmed'
    AND m.deleted_at IS NULL
    AND m.visibility = 'public'
  ORDER BY m.kind DESC, m.created_at, m.id;
$$;

REVOKE ALL ON FUNCTION public.milestones_shown_to_members(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.milestones_shown_to_members(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.milestones_shown_on_web(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.milestones_shown_on_web(text) TO service_role;

COMMENT ON FUNCTION public.milestones_shown_to_members(text) IS
  'The member''s confirmed milestones at community or public level, for the profile page other members see. Never a private one, whoever calls; no id.';
COMMENT ON FUNCTION public.milestones_shown_on_web(text) IS
  'The member''s confirmed milestones at the public level only, for the writer profile on the web (service role). The page decides whether the profile is on.';

COMMENT ON TABLE public.member_milestones IS
  'LOCAL: a member''s Finisher milestones (the_end, publish_ready; published is derived from member_books), one row per work. Staff propose (starts proposed) and the member confirms or declines; a member can also add their own, already confirmed (source member). visibility (private, community, public) says who sees it; only a confirmed row is anything but private. One marketing consent (consent_testimonial), off by default, only on a confirmed row; consent_profile and consent_homepage are no longer used. Readable only by the member and admins; other members and the web read through milestones_shown_to_members and milestones_shown_on_web. Tier 2: the id is never shown. [id prefix: mlst_]';
