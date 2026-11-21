set lock_timeout = '5s';

-- Version history for the site template (docs/product/LANDING_PAGES.md, "Site template"): one row each time the site design is
-- published, the way a landing page keeps one per publish, so a bad publish (which changes every website page at once) can be
-- undone by bringing an earlier version back into the draft. Expand only: new table, new columns, new functions.
-- Admin only, insert-only for admins (a kept version is never edited or deleted). Tier 2 id: never in a URL.

CREATE TABLE public.landing_site_template_versions (
  id text PRIMARY KEY DEFAULT public.new_id('lpstv'),
  template_id text NOT NULL REFERENCES public.landing_site_template(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  published_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX landing_site_template_versions_template ON public.landing_site_template_versions (template_id, created_at DESC);
CREATE INDEX landing_site_template_versions_published_by ON public.landing_site_template_versions (published_by);

COMMENT ON TABLE public.landing_site_template_versions IS
  'LOCAL: One row per publish of the site template (the header, footer, style and favicon shared by every website page): the published JSON, kept so an earlier version can be brought back into the draft. Insert-only for admins. [id prefix: lpstv_]';

ALTER TABLE public.landing_site_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read site template versions" ON public.landing_site_template_versions
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins add site template versions" ON public.landing_site_template_versions
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

-- No anon grants: no signed-out visitor reads this table. Supabase's default privileges would also hand `authenticated` UPDATE and
-- DELETE, so take everything back first: a kept version is never edited or deleted by an admin.
REVOKE ALL ON public.landing_site_template_versions FROM anon, authenticated;
GRANT SELECT, INSERT ON public.landing_site_template_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_site_template_versions TO service_role;

-- Bringing a version back, and throwing the draft away, change only the draft, which the audit trigger ignores. These two stamps
-- change a column the trigger does watch, so each is one audit entry (neither document is logged: the trigger redacts them).
ALTER TABLE public.landing_site_template ADD COLUMN restored_from_version_id text;
ALTER TABLE public.landing_site_template ADD COLUMN restored_at timestamptz;
ALTER TABLE public.landing_site_template ADD COLUMN draft_reset_at timestamptz;

-- The version already live is its first version, so History is not empty on a site that was published before this existed.
INSERT INTO public.landing_site_template_versions (template_id, data, published_by, created_at)
SELECT id, published_data, published_by, COALESCE(published_at, now())
  FROM public.landing_site_template
 WHERE published_data IS NOT NULL;

-- Publish: the draft becomes the published copy and a version, in one transaction. Runs as the caller (RLS: admins only).
-- False when the site has never been saved, so there is nothing to publish.
CREATE FUNCTION public.publish_landing_site_template()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  site public.landing_site_template;
BEGIN
  UPDATE public.landing_site_template
     SET published_data = draft_data,
         published_at = now(),
         published_by = auth.uid(),
         updated_by = auth.uid(),
         updated_at = now()
   -- `singleton` is always true: the table holds one row. The clause is there because PostgREST refuses an UPDATE without a WHERE.
   WHERE singleton
   RETURNING * INTO site;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO public.landing_site_template_versions (template_id, data, published_by)
  VALUES (site.id, site.published_data, auth.uid());
  RETURN true;
END $$;

-- Restore: a version's content becomes the draft. It does not publish; that stays an explicit step.
CREATE FUNCTION public.restore_landing_site_template_version(p_version_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  restored_id text;
BEGIN
  UPDATE public.landing_site_template t
     SET draft_data = v.data,
         restored_from_version_id = v.id,
         restored_at = now(),
         updated_by = auth.uid(),
         updated_at = now()
    FROM public.landing_site_template_versions v
   WHERE v.id = p_version_id AND t.id = v.template_id
   RETURNING t.id INTO restored_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.publish_landing_site_template() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_landing_site_template_version(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_landing_site_template() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_landing_site_template_version(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
