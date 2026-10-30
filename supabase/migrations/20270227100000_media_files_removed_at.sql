-- The nightly media sweep (/api/reconcile/media) removes the files of an image deleted long ago. This records
-- when it did, so it doesn't look at the same deleted rows every night; the row stays (soft delete).
ALTER TABLE public.media_assets ADD COLUMN files_removed_at timestamptz;
CREATE INDEX media_assets_files_to_remove_idx ON public.media_assets (deleted_at) WHERE deleted_at IS NOT NULL AND files_removed_at IS NULL;
