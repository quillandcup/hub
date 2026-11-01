-- The media library (docs/MEDIA_LIBRARY.md): one row per uploaded image, the original kept untouched in
-- the private `media` bucket. Pages ask for an asset plus a named preset (lib/media/presets.ts); the sized
-- copies ("renditions") are made from the original on first request and cached under `renditions/`.
-- Foreign keys from the places that show an image (events, book covers, course images) arrive with the
-- PRs that use them.
CREATE TABLE public.media_assets (
  id text PRIMARY KEY DEFAULT public.new_id('img'),
  -- The original, as uploaded: <id>/original.<ext>. Never served to a page.
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  bytes integer NOT NULL CHECK (bytes > 0),
  -- Of the original's bytes: the same file uploaded twice is one asset.
  sha256 text NOT NULL,
  title text NOT NULL,
  alt_text text,
  tags text[] NOT NULL DEFAULT '{}',
  -- Where the interesting part of the picture is, 0..1 from the top left. Null = let the cropper decide.
  focal_x numeric CHECK (focal_x BETWEEN 0 AND 1),
  focal_y numeric CHECK (focal_y BETWEEN 0 AND 1),
  -- How a preset fits a picture of a different shape, per preset: {"book_cover_shelf": "extend"}.
  fits jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Null = the shared library (staff manage it, every member can read it); set = that member's own.
  owner_member_id text REFERENCES public.members(id) ON DELETE CASCADE,
  -- Served to signed-out visitors too (the Bookshelf and events pages, once they are public).
  is_public boolean NOT NULL DEFAULT false,
  -- 'upload', 'kajabi' (source_key = the Kajabi URL without its query string) or 'video_frame'
  -- (source_key = '<video id>@<seconds>'); together they make an import idempotent.
  source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'kajabi', 'video_frame')),
  source_key text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((focal_x IS NULL) = (focal_y IS NULL)),
  CHECK (source = 'upload' OR source_key IS NOT NULL)
);

-- One live copy of a file per owner (the shared library has owner null, which unique indexes treat as distinct).
CREATE UNIQUE INDEX media_assets_owner_sha256_key ON public.media_assets (coalesce(owner_member_id, ''), sha256) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX media_assets_source_key ON public.media_assets (source, source_key) WHERE source_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX media_assets_owner ON public.media_assets (owner_member_id) WHERE deleted_at IS NULL;
CREATE INDEX media_assets_tags ON public.media_assets USING gin (tags);

CREATE TRIGGER update_media_assets_updated_at
  BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.media_assets IS 'LOCAL: the media library. An uploaded image (the original, never modified) with its title, tags, focal point and owner; sized copies are derived. Soft-deleted with deleted_at. [id prefix: img_]';

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

-- Live shared assets are for every signed-in member; a member's own are for them; staff see everything.
CREATE POLICY "Read shared, own and (as staff) all media assets"
  ON public.media_assets FOR SELECT TO authenticated
  USING (is_admin() OR (deleted_at IS NULL AND (owner_member_id IS NULL OR owner_member_id = current_member_id())));

CREATE POLICY "Staff manage the shared library, members their own"
  ON public.media_assets FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR owner_member_id = current_member_id());

CREATE POLICY "Update shared (staff) or own media assets"
  ON public.media_assets FOR UPDATE TO authenticated
  USING (is_admin() OR owner_member_id = current_member_id())
  WITH CHECK (is_admin() OR owner_member_id = current_member_id());

CREATE POLICY "Delete shared (staff) or own media assets"
  ON public.media_assets FOR DELETE TO authenticated
  USING (is_admin() OR owner_member_id = current_member_id());

-- No anon grant: signed-out visitors get public assets through /api/media (service role), never the table.
REVOKE ALL ON public.media_assets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO service_role;

-- Private bucket for originals and renditions, 25 MB an object. Deliberately no storage.objects policies:
-- nobody reads it directly; /api/media/<id>/<preset> checks the caller and streams the object.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('media', 'media', false, 26214400)
ON CONFLICT (id) DO NOTHING;
