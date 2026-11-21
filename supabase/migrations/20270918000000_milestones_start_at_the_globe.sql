-- A milestone starts at the globe, and the strips list works (docs/product/FINISHERS.md).
--
-- 1. Owner decision: a confirmed milestone starts at 'public', not 'community', so a writer's page is good enough on the day they
--    switch it on, without changing each item (a book on the Bookshelf is public already). The globe still reaches the web only
--    when writer profiles are open to the member and their page is on; signed-in members see it either way. The member can
--    still pick a level when they confirm, and the lock and house stay one click away. The app's constant is
--    MILESTONE_DEFAULT_VISIBILITY (lib/finishers.ts); a test keeps the two in step. A row that is already confirmed keeps the
--    level it has: this changes only what a first confirmation starts at.
-- 2. Two readers that list works: each work with its milestones in order (THE END, publish-ready, Published). Published is
--    derived from the live Bookshelf books and has no stored level (it is the globe, since the Bookshelf already shows
--    books); a book with a project is the same work as that project. `work_no` numbers the works for the page (1, 2, 3...), so
--    the page can group rows without being given an id (Tier 2). They sit beside `milestones_shown_to_members` and
--    `milestones_shown_on_web`, which stay until the contract step (docs/TODO.md, "Finisher record: what is left").
--
-- Expand only: a replaced trigger function body and three new functions. Nothing is dropped.

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.member_milestones_default_visibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status <> 'confirmed' AND OLD.visibility = 'private' AND NEW.visibility = 'private' THEN
    NEW.visibility := 'public';
  END IF;
  RETURN NEW;
END $$;

-- The shared body: confirmed, live milestones at the given levels, plus one Published row per live book, grouped into works.
-- Not callable by clients; the two readers below are the only way in and each does its own caller check.
CREATE FUNCTION public.member_works_shown(p_member_id text, p_levels text[])
RETURNS TABLE (work_no integer, kind text, work_title text, achieved_on date, story_before text, story_after text, visibility text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH items AS (
    SELECT
      coalesce(b.project_id, m.project_id, m.book_id, 'title:' || lower(btrim(regexp_replace(m.title, '\s+', ' ', 'g'))), '') AS work_key,
      m.kind AS kind,
      coalesce(m.title, b.title) AS title,
      m.achieved_on AS achieved_on,
      m.story_before AS story_before,
      m.story_after AS story_after,
      m.visibility AS visibility,
      CASE m.kind WHEN 'the_end' THEN 1 ELSE 2 END AS step,
      m.created_at AS created_at
    FROM public.member_milestones m
    LEFT JOIN public.member_books b ON b.id = m.book_id AND b.deleted_at IS NULL
    WHERE m.member_id = p_member_id
      AND m.status = 'confirmed'
      AND m.deleted_at IS NULL
      AND m.visibility = ANY (p_levels)
    UNION ALL
    SELECT coalesce(b.project_id, b.id), 'published', b.title, b.published_date, NULL, NULL, 'public', 3, b.created_at
    FROM public.member_books b
    WHERE b.member_id = p_member_id
      AND b.deleted_at IS NULL
  ), grouped AS (
    SELECT i.*,
      max(i.title) OVER (PARTITION BY i.work_key) AS work_title,
      min(i.created_at) OVER (PARTITION BY i.work_key) AS work_first
    FROM items i
  )
  SELECT
    dense_rank() OVER (ORDER BY g.work_first, g.work_key)::integer,
    g.kind, g.work_title, g.achieved_on, g.story_before, g.story_after, g.visibility
  FROM grouped g
  ORDER BY 1, g.step, g.created_at;
$$;

REVOKE ALL ON FUNCTION public.member_works_shown(text, text[]) FROM PUBLIC, anon, authenticated;

-- What other members see on a member's profile: milestones at community or public level, and Published. A signed-in member or
-- the service role only.
CREATE FUNCTION public.member_works_shown_to_members(p_member_id text)
RETURNS TABLE (work_no integer, kind text, work_title text, achieved_on date, story_before text, story_after text, visibility text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT w.work_no, w.kind, w.work_title, w.achieved_on, w.story_before, w.story_after, w.visibility
  FROM public.member_works_shown(p_member_id, ARRAY['community', 'public']) w
  WHERE (SELECT auth.role()) IN ('authenticated', 'service_role');
$$;

-- What a visitor of the web sees: milestones at the globe, and Published. Service role only (the page runs with it, after its
-- own checks that the writer profile is on and the member has the feature).
CREATE FUNCTION public.member_works_shown_on_web(p_member_id text)
RETURNS TABLE (work_no integer, kind text, work_title text, achieved_on date, story_before text, story_after text, visibility text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT w.work_no, w.kind, w.work_title, w.achieved_on, w.story_before, w.story_after, w.visibility
  FROM public.member_works_shown(p_member_id, ARRAY['public']) w;
$$;

REVOKE ALL ON FUNCTION public.member_works_shown_to_members(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_works_shown_to_members(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_works_shown_on_web(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_works_shown_on_web(text) TO service_role;

COMMENT ON FUNCTION public.member_works_shown(text, text[]) IS
  'Shared body of the two work readers: confirmed live milestones at the given levels plus one Published row per live Bookshelf book (derived, at the globe), grouped into numbered works (a book with a project is that project''s work). Not callable by clients.';
COMMENT ON FUNCTION public.member_works_shown_to_members(text) IS
  'A member''s works for the profile other members see: milestones at community or public level, and Published. Never a private milestone, whoever calls; no id.';
COMMENT ON FUNCTION public.member_works_shown_on_web(text) IS
  'A member''s works for the writer profile on the web (service role): milestones at the public level only, and Published. The page decides whether the profile is on.';
