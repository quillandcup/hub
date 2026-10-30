-- Book covers come from the media library (docs/MEDIA_LIBRARY.md): a member uploads any size, the Hub makes the
-- shelf size and the Amazon ebook cover from it. A cover is still stored as the URL every page already shows
-- (cover_url, now the library's /api/media/<id>/book_cover_shelf for a new cover; older covers keep theirs), and
-- cover_asset_id records which asset that is, for ownership, usage and the Amazon download.
--
-- NO ACTION (the default), not RESTRICT: deleting a member deletes their books and the assets they own in one
-- statement, and RESTRICT would fire the moment the asset goes, before the book that points at it has.
ALTER TABLE public.member_books ADD COLUMN cover_asset_id text REFERENCES public.media_assets(id);
ALTER TABLE public.writing_projects ADD COLUMN cover_asset_id text REFERENCES public.media_assets(id);
CREATE INDEX member_books_cover_asset_idx ON public.member_books (cover_asset_id) WHERE cover_asset_id IS NOT NULL;
CREATE INDEX writing_projects_cover_asset_idx ON public.writing_projects (cover_asset_id) WHERE cover_asset_id IS NOT NULL;

-- The Bookshelf shows every member's covers to every signed-in member, so a cover used by a book is readable by
-- all of them (a project's pre-publish cover stays with its owner, who owns the asset).
CREATE POLICY "Read the assets that are book covers"
  ON public.media_assets FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.member_books b WHERE b.cover_asset_id = media_assets.id));
