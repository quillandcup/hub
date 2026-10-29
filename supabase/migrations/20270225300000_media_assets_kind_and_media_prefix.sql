-- The media library is one catalog of everything people pick (docs/MEDIA_LIBRARY.md, "One catalog"), so its
-- ids use the general prefix `media_` instead of `img_`, and each row says what kind of thing it is.
-- Only images exist so far; a video (whose bytes live in Mux, described by `videos`) or a file arrives with
-- the migration that relaxes the image-only NOT NULLs for its kind. No row references an asset yet, so the
-- ids are rewritten in place.
ALTER TABLE public.media_assets ADD COLUMN kind text NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'video', 'file'));
ALTER TABLE public.media_assets ALTER COLUMN id SET DEFAULT public.new_id('media');
UPDATE public.media_assets SET id = 'media_' || substr(id, 5) WHERE id LIKE 'img\_%';
COMMENT ON TABLE public.media_assets IS 'LOCAL: the media library. An uploaded image (the original, never modified) with its title, tags, focal point and owner; sized copies are derived. kind says what it is (only images so far). Soft-deleted with deleted_at. [id prefix: media_]';
