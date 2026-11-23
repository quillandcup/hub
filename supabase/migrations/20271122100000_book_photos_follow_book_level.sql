set lock_timeout = '5s';

-- The photo of the member holding their book follows the book's own level (20271122000000_member_books_visibility.sql). The
-- picture readers (20271121000000_milestone_photos.sql) listed Published at the globe for every live book; now a book is listed, with its
-- photo, only when its level is one the reader serves (members: house and globe; the web: globe), so a photo is never seen by a viewer
-- who may not see the book, and a hidden book does not lend its title to a work. Same signature and result; only the body changes.
CREATE OR REPLACE FUNCTION public.member_works_pictured(p_member_id text, p_levels text[])
RETURNS TABLE (work_no integer, kind text, work_title text, achieved_on date, achieved_precision text, story_before text, story_after text, visibility text, photo_token text, photo_alt text)
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
      regexp_replace(split_part(m.photo_path, '/', 2), '\.webp$', '') AS photo_token,
      m.photo_alt AS photo_alt,
      CASE m.kind WHEN 'the_end' THEN 1 ELSE 2 END AS step,
      m.created_at AS created_at
    FROM public.member_milestones m
    -- The book's title only when the viewer may see the book itself.
    LEFT JOIN public.member_books b
      ON b.id = m.book_id
      AND b.deleted_at IS NULL
      AND b.visibility = ANY (p_levels)
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
    -- Published: one row per live book the viewer may see, at the book's own level, with the photo of the member holding it when there is one.
    SELECT coalesce(b.project_id, b.id), 'published', b.title, 2, b.published_date, 'day', NULL, NULL, b.visibility,
           regexp_replace(split_part(bp.photo_path, '/', 2), '\.webp$', ''), bp.photo_alt, 3, b.created_at
    FROM public.member_books b
    LEFT JOIN public.member_book_photos bp ON bp.book_id = b.id
    WHERE b.member_id = p_member_id
      AND b.deleted_at IS NULL
      AND b.visibility = ANY (p_levels)
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
    g.kind, g.work_title, g.achieved_on, g.achieved_precision, g.story_before, g.story_after, g.visibility, g.photo_token, g.photo_alt
  FROM grouped g
  ORDER BY 1, g.step, g.created_at;
$$;

COMMENT ON FUNCTION public.member_works_pictured(text, text[]) IS
  'Shared body of the picture readers: confirmed live milestones at the given levels, with their photo, plus one Published row per live Bookshelf book whose own level is one of the given levels (at that level), with the photo of the member holding it, grouped into numbered works. A book the viewer may not see neither adds a row nor names a work, and its photo is not returned. Not callable by clients.';
