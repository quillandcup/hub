set lock_timeout = '5s';

-- Landing pages built in the Hub's page builder (docs/product/LANDING_PAGES.md). A page is Puck JSON ({content, root}).
-- The draft is what the editor autosaves; publishing copies it to `published_data`, which is all the public
-- page ever renders, so an edit never goes live by accident.
--
-- Admin only. A signed-out visitor never reads this table: the public route reads a published page on the
-- server with the service role (the repository filters on status and deleted_at), so there is no anon policy
-- that a mistake could widen to drafts. Tier 2 id: it never appears in a URL; the address is the slug.

CREATE TABLE public.landing_pages (
  id text PRIMARY KEY DEFAULT public.new_id('lpg'),
  -- The public address (/p/<slug>) and the editor's (/admin/pages/<slug>): lowercase words joined by dashes.
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80),
  title text NOT NULL CHECK (char_length(btrim(title)) > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  -- Puck data. The draft is rewritten by autosave; `published_data` only by publishing.
  draft_data jsonb NOT NULL DEFAULT '{"content": [], "root": {}}'::jsonb,
  published_data jsonb,
  seo_title text,
  seo_description text,
  -- The picture shown when the page is shared (a media library asset; made public when the page is published).
  social_image_asset_id text REFERENCES public.media_assets(id) ON DELETE SET NULL,
  first_published_at timestamptz,
  published_at timestamptz,
  -- Set when a version is brought back into the draft, so the restore is one audit entry (draft saves are not audited).
  restored_from_version_id text,
  restored_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- A deleted page frees its address.
CREATE UNIQUE INDEX landing_pages_slug_live ON public.landing_pages (slug) WHERE deleted_at IS NULL;
CREATE INDEX landing_pages_social_image ON public.landing_pages (social_image_asset_id);

CREATE TABLE public.landing_page_versions (
  id text PRIMARY KEY DEFAULT public.new_id('lpgv'),
  page_id text NOT NULL REFERENCES public.landing_pages(id) ON DELETE CASCADE,
  title text NOT NULL,
  data jsonb NOT NULL,
  published_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX landing_page_versions_page ON public.landing_page_versions (page_id, created_at DESC);

COMMENT ON TABLE public.landing_pages IS
  'LOCAL: Landing pages from the page builder: Puck JSON as a draft (autosaved, not audited) and as published (what the public /p/<slug> renders). Admin only; the public route reads published pages with the service role. [id prefix: lpg_]';
COMMENT ON TABLE public.landing_page_versions IS
  'LOCAL: One row per publish of a landing page: the published Puck JSON, kept so an earlier version can be brought back into the draft. Insert-only. [id prefix: lpgv_]';

ALTER TABLE public.landing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_page_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read landing pages" ON public.landing_pages
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins create landing pages" ON public.landing_pages
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins change landing pages" ON public.landing_pages
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins read landing page versions" ON public.landing_page_versions
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins add landing page versions" ON public.landing_page_versions
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

-- No anon grants: no signed-out visitor reads these tables (Supabase's default privileges would otherwise hand them out).
REVOKE ALL ON public.landing_pages, public.landing_page_versions FROM anon;
-- Pages are deleted softly (deleted_at), so no DELETE.
GRANT SELECT, INSERT, UPDATE ON public.landing_pages TO authenticated;
GRANT SELECT, INSERT ON public.landing_page_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_pages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_page_versions TO service_role;

-- Audit the intent, not the keystrokes: a change of the draft (autosave) or of updated_at/updated_by alone writes
-- nothing. Creating, publishing, unpublishing, restoring, renaming, changing the address or SEO and deleting do.
-- The page JSON is logged as changed but never with its value (it can be large and is in the versions).
CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.landing_pages
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('landing_page', 'id', 'draft_data,published_data');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.landing_pages
  FOR EACH ROW WHEN ((to_jsonb(OLD) - 'draft_data' - 'updated_at' - 'updated_by') IS DISTINCT FROM (to_jsonb(NEW) - 'draft_data' - 'updated_at' - 'updated_by'))
  EXECUTE FUNCTION audit_row_change('landing_page', 'id', 'draft_data,published_data');

-- Publish: the draft becomes the published page and a version, in one transaction. Runs as the caller (RLS: admins only).
CREATE FUNCTION public.publish_landing_page(p_page_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  page public.landing_pages;
BEGIN
  UPDATE public.landing_pages
     SET published_data = draft_data,
         status = 'published',
         published_at = now(),
         first_published_at = COALESCE(first_published_at, now()),
         updated_by = auth.uid(),
         updated_at = now()
   WHERE id = p_page_id AND deleted_at IS NULL
   RETURNING * INTO page;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  INSERT INTO public.landing_page_versions (page_id, title, data, published_by)
  VALUES (page.id, page.title, page.published_data, auth.uid());
END $$;

-- Restore: a version's content becomes the draft. It does not publish; that stays an explicit step.
CREATE FUNCTION public.restore_landing_page_version(p_version_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  restored_id text;
BEGIN
  UPDATE public.landing_pages p
     SET draft_data = v.data,
         restored_from_version_id = v.id,
         restored_at = now(),
         updated_by = auth.uid(),
         updated_at = now()
    FROM public.landing_page_versions v
   WHERE v.id = p_version_id AND p.id = v.page_id AND p.deleted_at IS NULL
   RETURNING p.id INTO restored_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.publish_landing_page(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_landing_page_version(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_landing_page(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_landing_page_version(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
