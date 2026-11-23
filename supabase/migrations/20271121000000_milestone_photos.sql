-- Photos on milestones (docs/product/FINISHERS.md, "Photos"): the picture of the day a member wrote THE END, of the day it was
-- ready to publish, and of them holding the published book.
--
-- A photo is personal, so it follows the milestone's level (the lock, the house or the globe) and is never reachable by a
-- guessable address:
--   * The files live in a PRIVATE bucket, `milestone-photos`, with no storage policy at all: no public address, and only the
--     server (service role) reads or writes it. The server hands a picture out only after checking the viewer against the
--     milestone's level (src/app/api/milestone-photos/[token]/route.ts). The row stores the object path, never an address.
--   * A file is `<member id>/<random token>.webp`. The token is 128 random bits (not a hash of the picture), so a picture's
--     address cannot be worked out from the picture, and replacing a photo gives a new address.
--   * A member cannot write the columns: no UPDATE grant on the path, and a guard on INSERT (the table-wide INSERT grant would
--     otherwise reach them). Only the server, after checking the bytes and the owner, writes them. The member may write the
--     description of their own photo (`photo_alt`), a column grant, as for their other words.
--
-- THE END and publish-ready are stored milestones, so the photo is two columns on `member_milestones`. Published has no stored
-- row (it is derived from a Bookshelf book), so the "holding my book" photo is kept apart, one row per book, in
-- `member_book_photos`, and not as columns of `member_books`: that table belongs to the Bookshelf. It takes the level of the
-- Published step, which today is always the globe (a book is public). When a book gains a level of its own, the readers below
-- are the one place to read it from.
--
-- The dated readers cannot gain output columns in place, so three new readers sit beside them (as `member_works_dated*` did
-- beside the ones before): the same rows, plus the photo's address token and description. A photo is returned only with a row
-- the viewer may see, so a private milestone returns nothing, whoever calls. Their contract step is in docs/TODO.md.
--
-- Expand only: new nullable columns, a new table, a new bucket, new functions. Nothing existing changes.

set lock_timeout = '5s';

-- 1. The private bucket. A re-encoded WebP only, at most 5 MB (the server makes it at most 1600 pixels a side).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('milestone-photos', 'milestone-photos', false, 5242880, ARRAY['image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/webp'];

-- 2. THE END and publish-ready photos.
ALTER TABLE public.member_milestones
  ADD COLUMN photo_path text,
  ADD COLUMN photo_alt text;

ALTER TABLE public.member_milestones
  ADD CONSTRAINT member_milestones_photo_path_own_folder
    CHECK (photo_path IS NULL OR photo_path LIKE member_id || '/%.webp') NOT VALID,
  ADD CONSTRAINT member_milestones_photo_alt_needs_photo
    CHECK (photo_alt IS NULL OR (photo_path IS NOT NULL AND char_length(photo_alt) <= 300)) NOT VALID;
ALTER TABLE public.member_milestones VALIDATE CONSTRAINT member_milestones_photo_path_own_folder;
ALTER TABLE public.member_milestones VALIDATE CONSTRAINT member_milestones_photo_alt_needs_photo;

CREATE UNIQUE INDEX member_milestones_photo_path_key ON public.member_milestones (photo_path) WHERE photo_path IS NOT NULL;

COMMENT ON COLUMN public.member_milestones.photo_path IS
  'Object path of the member''s photo for this milestone in the private milestone-photos bucket (<member id>/<token>.webp). Written only by the server. Served only to a viewer the milestone''s level allows. Redacted in the audit log.';
COMMENT ON COLUMN public.member_milestones.photo_alt IS
  'What the photo shows, written by the member for people who cannot see it (at most 300 characters). Redacted in the audit log.';

-- The member writes the description of their own photo with the rest of their answer; nothing else about the photo.
GRANT UPDATE (photo_alt) ON public.member_milestones TO authenticated;

-- The table-wide INSERT grant would let a member name a path when they add a milestone: only the server may.
CREATE FUNCTION public.member_milestones_photo_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.photo_path IS NOT NULL AND (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'a milestone photo is written by the server only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.member_milestones_photo_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER member_milestones_photo_guard
  BEFORE INSERT ON public.member_milestones
  FOR EACH ROW EXECUTE FUNCTION public.member_milestones_photo_guard();

-- The Activity Log says that the photo changed, never where it is or what it shows.
DROP TRIGGER audit_row_change_insert ON public.member_milestones;
DROP TRIGGER audit_row_change_update ON public.member_milestones;
CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.member_milestones
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('member_milestone', 'id', 'story_before,story_after,title,photo_path,photo_alt');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.member_milestones
  FOR EACH ROW WHEN ((to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))
  EXECUTE FUNCTION public.audit_row_change('member_milestone', 'id', 'story_before,story_after,title,photo_path,photo_alt');

-- 3. The "holding my book" photo: one per Bookshelf book.
CREATE TABLE public.member_book_photos (
  book_id text PRIMARY KEY REFERENCES public.member_books(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  photo_path text NOT NULL CHECK (photo_path LIKE member_id || '/%.webp'),
  photo_alt text CHECK (photo_alt IS NULL OR char_length(photo_alt) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX member_book_photos_photo_path_key ON public.member_book_photos (photo_path);
CREATE INDEX member_book_photos_member_idx ON public.member_book_photos (member_id);

COMMENT ON TABLE public.member_book_photos IS
  'LOCAL: the photo of a member holding their published book (one per Bookshelf book), in the private milestone-photos bucket. Written only by the server; the member reads their own and may edit its description. Shown as part of the Published step, at the level of that step. Keyed by the book, so the key is not its own id.';

ALTER TABLE public.member_book_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own book photos" ON public.member_book_photos
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()));

-- Never while an admin views as the member (sudo).
CREATE POLICY "Members describe their own book photo" ON public.member_book_photos
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL)
  WITH CHECK (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL);

REVOKE ALL ON public.member_book_photos FROM anon, authenticated;
GRANT SELECT ON public.member_book_photos TO authenticated;
GRANT UPDATE (photo_alt, updated_at) ON public.member_book_photos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_book_photos TO service_role;

-- A removal request deletes them with the member (supabase/tests/database/member_data_handling.test.sql keeps this list complete);
-- the files in the bucket are deleted by the removal code (src/lib/member-removal.ts).
INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('member_book_photos', 'member_id', 'delete', 'a photo of the member, which means nothing without them');

-- 4. The readers. The same works, steps and levels as `member_works_dated*`, plus the photo of each step the viewer may see.
-- `photo_token` is the file name without its extension (what the picture's address carries); `photo_alt` its description.
CREATE FUNCTION public.member_works_pictured(p_member_id text, p_levels text[])
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
    -- Published: derived from the live Bookshelf book, at the globe, with the photo of the member holding it when there is one.
    SELECT coalesce(b.project_id, b.id), 'published', b.title, 2, b.published_date, 'day', NULL, NULL, 'public',
           regexp_replace(split_part(bp.photo_path, '/', 2), '\.webp$', ''), bp.photo_alt, 3, b.created_at
    FROM public.member_books b
    LEFT JOIN public.member_book_photos bp ON bp.book_id = b.id
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
    g.kind, g.work_title, g.achieved_on, g.achieved_precision, g.story_before, g.story_after, g.visibility, g.photo_token, g.photo_alt
  FROM grouped g
  ORDER BY 1, g.step, g.created_at;
$$;

REVOKE ALL ON FUNCTION public.member_works_pictured(text, text[]) FROM PUBLIC, anon, authenticated;

-- What other members see on a member's profile: community and public, and Published. A signed-in member or the service role only.
CREATE FUNCTION public.member_works_pictured_to_members(p_member_id text)
RETURNS TABLE (work_no integer, kind text, work_title text, achieved_on date, achieved_precision text, story_before text, story_after text, visibility text, photo_token text, photo_alt text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT w.work_no, w.kind, w.work_title, w.achieved_on, w.achieved_precision, w.story_before, w.story_after, w.visibility, w.photo_token, w.photo_alt
  FROM public.member_works_pictured(p_member_id, ARRAY['community', 'public']) w
  WHERE (SELECT auth.role()) IN ('authenticated', 'service_role');
$$;

-- What a visitor of the web sees: the globe, and Published. Service role only (the page checks that the profile is on).
CREATE FUNCTION public.member_works_pictured_on_web(p_member_id text)
RETURNS TABLE (work_no integer, kind text, work_title text, achieved_on date, achieved_precision text, story_before text, story_after text, visibility text, photo_token text, photo_alt text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT w.work_no, w.kind, w.work_title, w.achieved_on, w.achieved_precision, w.story_before, w.story_after, w.visibility, w.photo_token, w.photo_alt
  FROM public.member_works_pictured(p_member_id, ARRAY['public']) w;
$$;

REVOKE ALL ON FUNCTION public.member_works_pictured_to_members(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_works_pictured_to_members(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_works_pictured_on_web(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_works_pictured_on_web(text) TO service_role;

COMMENT ON FUNCTION public.member_works_pictured(text, text[]) IS
  'Shared body of the pictured work readers: confirmed live milestones at the given levels plus one Published row per live Bookshelf book, with the token and description of the photo of each. A photo comes only with a row the viewer may see. Not callable by clients.';
COMMENT ON FUNCTION public.member_works_pictured_to_members(text) IS
  'A member''s works with their photos for the profile other members see (community and public, and Published). Never a private milestone or its photo, whoever calls; no id.';
COMMENT ON FUNCTION public.member_works_pictured_on_web(text) IS
  'A member''s works with their photos for the writer profile on the web (service role): the globe only, and Published.';
