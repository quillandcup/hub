-- The strips name a work whenever the viewer may see its project (docs/product/FINISHERS.md).
--
-- A work that is only a project (no Bookshelf book, no title the member wrote) came out of `member_works_shown` with no name, so the
-- strips showed a bare "Finisher · Wrote THE END" and several in a row looked like duplicates. The shared body now also names the
-- work by its project's title, but only when the project itself is visible to the viewer: the project's level must be one of the
-- levels this read serves (community and public for a signed-in member, public only for the web), the same rule as the project's
-- own page. A project the viewer may not see still has no name here (the strip says "Another work"), and its title never leaves the
-- database. The title order is the title the member wrote, then the book's title, then the project's.
--
-- Same signature and same columns, so this replaces the body only (expand-only; the two readers that wrap it are unchanged).
--
-- It also drops `milestones_shown_on_web(text)`: the web strip has read `member_works_shown_on_web` since the works readers
-- shipped, and nothing in the code calls the older one (the repository does not wrap it).

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.member_works_shown(p_member_id text, p_levels text[])
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
      coalesce(m.title, b.title, p.title) AS title,
      CASE WHEN m.title IS NOT NULL THEN 1 WHEN b.title IS NOT NULL THEN 2 ELSE 3 END AS title_rank,
      m.achieved_on AS achieved_on,
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
    SELECT coalesce(b.project_id, b.id), 'published', b.title, 2, b.published_date, NULL, NULL, 'public', 3, b.created_at
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
    g.kind, g.work_title, g.achieved_on, g.story_before, g.story_after, g.visibility
  FROM grouped g
  ORDER BY 1, g.step, g.created_at;
$$;

REVOKE ALL ON FUNCTION public.member_works_shown(text, text[]) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.member_works_shown(text, text[]) IS
  'Shared body of the two work readers: confirmed live milestones at the given levels plus one Published row per live Bookshelf book (derived, at the globe), grouped into numbered works (a book with a project is that project''s work). A work is named by the title the member wrote, else its book''s title, else its project''s title only when the project''s own level is one of the given levels; otherwise null. Not callable by clients.';

-- Approved ban-drop-function ignore (owner, 2026-11-22): nothing in the code reads this function any more; the web strip reads
-- member_works_shown_on_web.
-- squawk-ignore ban-drop-function
DROP FUNCTION public.milestones_shown_on_web(text);
