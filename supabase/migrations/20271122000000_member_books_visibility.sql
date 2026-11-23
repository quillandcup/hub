set lock_timeout = '5s';

-- A level for each Bookshelf book: private (only the member), community (signed-in members) or public (the web), the same three
-- levels as a writing project (docs/product/WRITER_PROFILES.md, "Who sees what").
--
-- EXPAND only. A book that is already on the Bookshelf was on the public list the members submitted it to, so every existing row
-- becomes public: the column's default does it (a constant default is not a table rewrite), and the code live during the deploy,
-- which never names the column, keeps inserting public books. Nothing is removed.
--
-- Who reads what changes with it:
--   * the "view member_books" policy shows other members only live books that are not private (the owner and staff keep their own
--     policy, which covers every row);
--   * the "assets that are book covers" policy on media_assets follows it, so a private book's cover is not readable by other members;
--   * member_works_dated, the shared body of the profile strips, names a work by a book's title and lists its Published step only
--     when the book's level is one of the levels being read (members: community and public; the web: public). The step used to be
--     derived at the globe whatever the book. Held back whoever calls, staff included: the two readers on top of it are the only
--     callable entry points.
ALTER TABLE public.member_books ADD COLUMN visibility text NOT NULL DEFAULT 'public';

ALTER TABLE public.member_books
  ADD CONSTRAINT member_books_visibility_check CHECK (visibility IN ('private', 'community', 'public')) NOT VALID;
ALTER TABLE public.member_books VALIDATE CONSTRAINT member_books_visibility_check;

COMMENT ON COLUMN public.member_books.visibility IS
  'Who can see the book: private (only the member and staff), community (signed-in members) or public (the web, on a public page that lists books). Existing books started public: the list they were submitted to was public.';

DROP POLICY "Authenticated users can view member_books" ON public.member_books;
CREATE POLICY "Authenticated users can view member_books" ON public.member_books
  FOR SELECT USING (auth.role() = 'authenticated' AND deleted_at IS NULL AND visibility <> 'private');

DROP POLICY "Read the assets that are book covers" ON public.media_assets;
CREATE POLICY "Read the assets that are book covers"
  ON public.media_assets FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.member_books b
    WHERE b.cover_asset_id = media_assets.id AND b.deleted_at IS NULL AND b.visibility <> 'private'));

-- The shared body of the dated work readers (20271020000000), with the book's own level. Same signature and result.
CREATE OR REPLACE FUNCTION public.member_works_dated(p_member_id text, p_levels text[])
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
    -- Published: one row per live book the viewer may see, at the book's own level.
    SELECT coalesce(b.project_id, b.id), 'published', b.title, 2, b.published_date, 'day', NULL, NULL, b.visibility, 3, b.created_at
    FROM public.member_books b
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
    g.kind, g.work_title, g.achieved_on, g.achieved_precision, g.story_before, g.story_after, g.visibility
  FROM grouped g
  ORDER BY 1, g.step, g.created_at;
$$;

COMMENT ON FUNCTION public.member_works_dated(text, text[]) IS
  'Shared body of the dated work readers: confirmed live milestones at the given levels, with the precision of each date, plus one Published row per live Bookshelf book whose own level is one of the given levels (at that level), grouped into numbered works. A book the viewer may not see neither adds a row nor names a work. Not callable by clients.';

-- The one-time heads-up that a member's published books are on the public Hedgie Bookshelf starts in dry run: the flag says who
-- gets it for real (an admin's own preview first, then a segment, then everyone); for everyone else the job only logs what it would
-- have sent and writes nothing (src/lib/book-visibility-notice.ts).
INSERT INTO public.feature_flags (feature_key, enabled_globally)
VALUES ('book_visibility_notice', false)
ON CONFLICT (feature_key) DO NOTHING;
