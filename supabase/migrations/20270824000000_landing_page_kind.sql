set lock_timeout = '5s';

-- Templates are pages of a special kind (docs/product/LANDING_PAGES.md, "Templates"): the same table, draft and published copy, versions and
-- History as a page, but never on the public site. `kind` says which; every reader of published pages filters on 'page'.
-- Expand only: the default makes every existing row a page, and nothing reads a template until the code that makes one ships.
ALTER TABLE public.landing_pages ADD COLUMN kind text NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'template'));
COMMENT ON COLUMN public.landing_pages.kind IS
  'page: a public landing page; template: a page kept to start other pages from. A template is never served on /p/<slug> and never takes a sign-up. It never changes after the row is made.';

-- A page can't turn into a template or back: a template that became a page would go public, and the reverse would take a live page down.
CREATE FUNCTION public.landing_pages_kind_is_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'landing_page_kind_is_fixed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER landing_pages_kind_is_fixed
  BEFORE UPDATE OF kind ON public.landing_pages
  FOR EACH ROW EXECUTE FUNCTION public.landing_pages_kind_is_fixed();

-- A template's changes are Activity Log entries of their own type (the sentence says "the template", and an update's delta
-- doesn't carry the unchanged `kind`), with the same redaction as a page: no page content and no typed search text.
DROP TRIGGER audit_row_change_insert ON public.landing_pages;
DROP TRIGGER audit_row_change_update ON public.landing_pages;
CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.landing_pages
  FOR EACH ROW WHEN (NEW.kind = 'page')
  EXECUTE FUNCTION audit_row_change('landing_page', 'id', 'draft_data,published_data,seo_title,seo_description');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.landing_pages
  FOR EACH ROW WHEN (NEW.kind = 'page' AND (to_jsonb(OLD) - 'draft_data' - 'updated_at' - 'updated_by') IS DISTINCT FROM (to_jsonb(NEW) - 'draft_data' - 'updated_at' - 'updated_by'))
  EXECUTE FUNCTION audit_row_change('landing_page', 'id', 'draft_data,published_data,seo_title,seo_description');
CREATE TRIGGER audit_row_change_template_insert
  AFTER INSERT ON public.landing_pages
  FOR EACH ROW WHEN (NEW.kind = 'template')
  EXECUTE FUNCTION audit_row_change('landing_page_template', 'id', 'draft_data,published_data,seo_title,seo_description');
CREATE TRIGGER audit_row_change_template_update
  AFTER UPDATE ON public.landing_pages
  FOR EACH ROW WHEN (NEW.kind = 'template' AND (to_jsonb(OLD) - 'draft_data' - 'updated_at' - 'updated_by') IS DISTINCT FROM (to_jsonb(NEW) - 'draft_data' - 'updated_at' - 'updated_by'))
  EXECUTE FUNCTION audit_row_change('landing_page_template', 'id', 'draft_data,published_data,seo_title,seo_description');

-- Versions are immutable: nothing changes or deletes one, not an admin and not the service role (the app only ever inserts). A page is
-- deleted softly, so nothing cascades.
REVOKE UPDATE, DELETE ON public.landing_page_versions FROM authenticated, service_role;

NOTIFY pgrst, 'reload schema';
