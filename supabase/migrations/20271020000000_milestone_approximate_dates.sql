-- Approximate dates for milestones (docs/product/FINISHERS.md).
--
-- A past milestone is hard to date exactly, so the member may give the day, only the month and year, only the year, or no date
-- at all (the date was already optional). `achieved_precision` says which: 'day' (the default, today's behavior), 'month' or
-- 'year'. `achieved_on` keeps the FIRST day of that period (2026-05-01 for "May 2026", 2026-01-01 for "2026"), so every existing
-- reader still gets a real date; a CHECK keeps the two in step. The rule "reached while a member" treats an imprecise date as the
-- LAST day of its period (one shared function in the app, `reachedWhileMember`), so it counts if any part of the period is on or
-- after the day the member joined.
--
-- The strips and the badges must show and weigh the precision, and a function cannot gain an output column in place, so three new
-- readers sit beside the old ones (`member_works_shown*`), which nothing will call once this is deployed; their contract step is in
-- docs/TODO.md. Same rules as before: confirmed, live milestones at the levels the viewer may see, plus Published from the live
-- Bookshelf books at the globe, a work named by the member's own title, else its book's, else its project's when the viewer may see
-- the project, never an id.
--
-- Expand only: a new column with a default, a validated CHECK, one column grant and three new functions.

set lock_timeout = '5s';

ALTER TABLE public.member_milestones
  ADD COLUMN achieved_precision text NOT NULL DEFAULT 'day';

ALTER TABLE public.member_milestones
  ADD CONSTRAINT member_milestones_achieved_precision_check
  CHECK (
    achieved_precision = 'day'
    OR (achieved_precision = 'month' AND (achieved_on IS NULL OR extract(day FROM achieved_on) = 1))
    OR (achieved_precision = 'year' AND (achieved_on IS NULL OR (extract(day FROM achieved_on) = 1 AND extract(month FROM achieved_on) = 1)))
  ) NOT VALID;

ALTER TABLE public.member_milestones VALIDATE CONSTRAINT member_milestones_achieved_precision_check;

COMMENT ON COLUMN public.member_milestones.achieved_precision IS
  'How exactly achieved_on is known: day, month or year. For month and year, achieved_on is the first day of the period.';

-- The member may change it with the rest of their answer (as achieved_on).
GRANT UPDATE (achieved_precision) ON public.member_milestones TO authenticated;

-- The shared body, with the precision of each date. Not callable by clients.
CREATE FUNCTION public.member_works_dated(p_member_id text, p_levels text[])
RETURNS TABLE (work_no integer, kind text, work_title text, achieved_on date, achieved_precision text, story_before text, story_after text, visibility text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH items AS (
    SELECT
      coalesce(b.project_id, m.project_id, m.book_id, 'title:' || lower(btrim(regexp_replace(m.title, '\s+', ' ', 'g'))), '') AS work_key,
      m.kind AS kind,
      coalesce(m.title, b.title, p.title) AS title,
      CASE WHEN m.title IS NOT NULL THEN 1 WHEN b.title IS NOT NULL THEN 2 ELSE 3 END AS title_rank,
      m.achieved_on AS achieved_on,
      m.achieved_precision AS achieved_precision,
      m.story_before AS story_before,
      m.story_after AS story_after,
      m.visibility AS visibility,
      CASE m.kind WHEN 'the_end' THEN 1 ELSE 2 END AS step,
      m.created_at AS created_at
    FROM public.member_milestones m
    LEFT JOIN public.member_books b ON b.id = m.book_id AND b.deleted_at IS NULL
    -- The project's title only when the viewer may see the project itself.
    LEFT JOIN public.writing_projects p
      ON p.id = coalesce(m.project_id, b.project_id)
      AND p.deleted_at IS NULL
      AND p.visibility = ANY (p_levels)
    WHERE m.member_id = p_member_id
      AND m.status = 'confirmed'
      AND m.deleted_at IS NULL
      AND m.visibility = ANY (p_levels)
    UNION ALL
    SELECT coalesce(b.project_id, b.id), 'published', b.title, 2, b.published_date, 'day', NULL, NULL, 'public', 3, b.created_at
    FROM public.member_books b
    WHERE b.member_id = p_member_id
      AND b.deleted_at IS NULL
  ), grouped AS (
    SELECT i.*,
      first_value(i.title) OVER (
        PARTITION BY i.work_key
        ORDER BY (i.title IS NULL), i.title_rank, i.created_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      ) AS work_title,
      min(i.created_at) OVER (PARTITION BY i.work_key) AS work_first
    FROM items i
  )
  SELECT
    dense_rank() OVER (ORDER BY g.work_first, g.work_key)::integer,
    g.kind, g.work_title, g.achieved_on, g.achieved_precision, g.story_before, g.story_after, g.visibility
  FROM grouped g
  ORDER BY 1, g.step, g.created_at;
$$;

REVOKE ALL ON FUNCTION public.member_works_dated(text, text[]) FROM PUBLIC, anon, authenticated;

-- What other members see on a member's profile: community and public, and Published. A signed-in member or the service role only.
CREATE FUNCTION public.member_works_dated_to_members(p_member_id text)
RETURNS TABLE (work_no integer, kind text, work_title text, achieved_on date, achieved_precision text, story_before text, story_after text, visibility text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT w.work_no, w.kind, w.work_title, w.achieved_on, w.achieved_precision, w.story_before, w.story_after, w.visibility
  FROM public.member_works_dated(p_member_id, ARRAY['community', 'public']) w
  WHERE (SELECT auth.role()) IN ('authenticated', 'service_role');
$$;

-- What a visitor of the web sees: the globe, and Published. Service role only (the page checks that the profile is on).
CREATE FUNCTION public.member_works_dated_on_web(p_member_id text)
RETURNS TABLE (work_no integer, kind text, work_title text, achieved_on date, achieved_precision text, story_before text, story_after text, visibility text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT w.work_no, w.kind, w.work_title, w.achieved_on, w.achieved_precision, w.story_before, w.story_after, w.visibility
  FROM public.member_works_dated(p_member_id, ARRAY['public']) w;
$$;

REVOKE ALL ON FUNCTION public.member_works_dated_to_members(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_works_dated_to_members(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_works_dated_on_web(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_works_dated_on_web(text) TO service_role;

COMMENT ON FUNCTION public.member_works_dated(text, text[]) IS
  'Shared body of the dated work readers: confirmed live milestones at the given levels, with the precision of each date, plus one Published row per live Bookshelf book, grouped into numbered works. Not callable by clients.';
COMMENT ON FUNCTION public.member_works_dated_to_members(text) IS
  'A member''s works for the profile other members see (community and public, and Published), with date precision. Never a private milestone, whoever calls; no id.';
COMMENT ON FUNCTION public.member_works_dated_on_web(text) IS
  'A member''s works for the writer profile on the web (service role): the globe only, and Published, with date precision.';
