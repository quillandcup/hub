set lock_timeout = '5s';

-- The Activity Log's sentences for the page builder (lib/activity-feed.ts): a template's audit entry has to say whether the
-- version number moved because of a save over it or because an earlier version was brought back, which the row alone can't
-- show. `last_save_kind` is set by the two save functions (created, overwritten or restored) and is what the sentence reads.
-- Expand only: nothing else reads the column.
ALTER TABLE public.landing_page_templates ADD COLUMN last_save_kind text;
COMMENT ON COLUMN public.landing_page_templates.last_save_kind IS
  'How the current version came to be: created, overwritten or restored. Set by save_landing_page_template and restore_landing_page_template_version so the audit entry can say which.';

-- The typed description is never in the audit log (a description is free text); the name is, since the feed names the template.
DROP TRIGGER audit_row_change_insert ON public.landing_page_templates;
DROP TRIGGER audit_row_change_update ON public.landing_page_templates;
CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.landing_page_templates
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('landing_page_template', 'id', 'data,description');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.landing_page_templates
  FOR EACH ROW WHEN ((to_jsonb(OLD) - 'updated_at' - 'updated_by') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at' - 'updated_by'))
  EXECUTE FUNCTION audit_row_change('landing_page_template', 'id', 'data,description');

-- Pages: the search text an admin types is not logged either (the sentence says the search details changed, not to what).
DROP TRIGGER audit_row_change_insert ON public.landing_pages;
DROP TRIGGER audit_row_change_update ON public.landing_pages;
CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.landing_pages
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('landing_page', 'id', 'draft_data,published_data,seo_title,seo_description');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.landing_pages
  FOR EACH ROW WHEN ((to_jsonb(OLD) - 'draft_data' - 'updated_at' - 'updated_by') IS DISTINCT FROM (to_jsonb(NEW) - 'draft_data' - 'updated_at' - 'updated_by'))
  EXECUTE FUNCTION audit_row_change('landing_page', 'id', 'draft_data,published_data,seo_title,seo_description');

CREATE OR REPLACE FUNCTION public.save_landing_page_template(p_name text, p_description text, p_data jsonb, p_template_id text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS TABLE (saved_id text, saved_version integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  tid text;
  v integer;
  k text;
  clean_name text := btrim(p_name);
  clean_description text := COALESCE(p_description, '');
BEGIN
  IF p_template_id IS NULL THEN
    INSERT INTO public.landing_page_templates (name, description, data, current_version, last_save_kind, created_by, updated_by)
    VALUES (clean_name, clean_description, p_data, 1, 'created', auth.uid(), auth.uid())
    RETURNING id, current_version INTO tid, v;
    k := 'created';
  ELSE
    UPDATE public.landing_page_templates
       SET name = clean_name,
           description = clean_description,
           data = p_data,
           current_version = current_version + 1,
           last_save_kind = 'overwritten',
           updated_by = auth.uid(),
           updated_at = now()
     WHERE id = p_template_id AND deleted_at IS NULL
     RETURNING id, current_version INTO tid, v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found';
    END IF;
    k := 'overwritten';
  END IF;
  INSERT INTO public.landing_page_template_versions (template_id, version, name, description, data, note, kind, created_by)
  VALUES (tid, v, clean_name, clean_description, p_data, NULLIF(btrim(COALESCE(p_note, '')), ''), k, auth.uid());
  RETURN QUERY SELECT tid, v;
END $$;

CREATE OR REPLACE FUNCTION public.restore_landing_page_template_version(p_version_id text)
RETURNS TABLE (saved_id text, saved_version integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  prev public.landing_page_template_versions;
  tid text;
  v integer;
  current_name text;
BEGIN
  SELECT ver.* INTO prev
    FROM public.landing_page_template_versions ver
    JOIN public.landing_page_templates t ON t.id = ver.template_id AND t.deleted_at IS NULL
   WHERE ver.id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  UPDATE public.landing_page_templates
     SET description = prev.description,
         data = prev.data,
         current_version = current_version + 1,
         last_save_kind = 'restored',
         updated_by = auth.uid(),
         updated_at = now()
   WHERE id = prev.template_id AND deleted_at IS NULL
   RETURNING id, current_version, name INTO tid, v, current_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  INSERT INTO public.landing_page_template_versions (template_id, version, name, description, data, note, kind, restored_from_version, created_by)
  VALUES (tid, v, current_name, prev.description, prev.data, NULL, 'restored', prev.version, auth.uid());
  RETURN QUERY SELECT tid, v;
END $$;

NOTIFY pgrst, 'reload schema';
