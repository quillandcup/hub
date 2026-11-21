set lock_timeout = '5s';

-- Saved templates for the page builder (docs/product/LANDING_PAGES.md, "Templates"): an admin saves a page's draft as a template,
-- starts new pages or restarts a page from it, and can overwrite it with a better version. Every save is kept as a version
-- so an earlier one can be reviewed and brought back. Expand only: a new pair of tables, nothing else reads them yet.
--
-- The page content may hold real names an admin typed, so it lives here and never in the repository. Admin only: no anon
-- policy or grant, and no community-manager access (opt-in rule for new roles). Tier 2 ids: they never appear in a URL.
--
-- A template's current content is always its latest version: `save_landing_page_template` and
-- `restore_landing_page_template_version` write the template row and the new version row in one transaction, as the caller
-- (SECURITY INVOKER, like `publish_landing_page`), so row-level security applies. Versions are insert-only: overwriting or
-- bringing back an old one adds version n + 1 and never rewrites history. A rename is a change of the template row alone
-- (audited, no new version).

CREATE TABLE public.landing_page_templates (
  id text PRIMARY KEY DEFAULT public.new_id('lpgt'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  -- The current version's page document: {content, root, schemaVersion}.
  data jsonb NOT NULL,
  -- The number of the latest version (1, 2, 3 ...).
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- A name is unique among live templates, whatever its case; a deleted template frees its name.
CREATE UNIQUE INDEX landing_page_templates_name_live ON public.landing_page_templates (lower(btrim(name))) WHERE deleted_at IS NULL;

CREATE TABLE public.landing_page_template_versions (
  id text PRIMARY KEY DEFAULT public.new_id('lpgtv'),
  template_id text NOT NULL REFERENCES public.landing_page_templates(id) ON DELETE CASCADE,
  -- 1, 2, 3 ... per template.
  version integer NOT NULL CHECK (version >= 1),
  -- The name and description as they were when this version was saved.
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  data jsonb NOT NULL,
  -- Why it changed (optional, free text typed by the admin; never logged).
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  -- created: the first save; overwritten: a better version saved over it; restored: an earlier version brought back.
  kind text NOT NULL DEFAULT 'created' CHECK (kind IN ('created', 'overwritten', 'restored')),
  -- For a restored version: the number of the version it was copied from.
  restored_from_version integer CHECK (restored_from_version IS NULL OR restored_from_version >= 1),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

COMMENT ON TABLE public.landing_page_templates IS
  'LOCAL: Saved page-builder templates: the current version''s Puck JSON (always the latest row of landing_page_template_versions), a name unique among live templates, soft delete. Admin only; the content may hold names an admin typed, so it is never logged. [id prefix: lpgt_]';
COMMENT ON TABLE public.landing_page_template_versions IS
  'LOCAL: One row per save of a landing page template (created, overwritten or restored), numbered 1, 2, 3 per template. Insert-only history for review and rollback. [id prefix: lpgtv_]';

ALTER TABLE public.landing_page_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_page_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read landing page templates" ON public.landing_page_templates
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins create landing page templates" ON public.landing_page_templates
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins change landing page templates" ON public.landing_page_templates
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins read landing page template versions" ON public.landing_page_template_versions
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins add landing page template versions" ON public.landing_page_template_versions
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

-- No anon grants, and authenticated gets only what it uses (Supabase's default privileges would otherwise hand out everything).
-- Templates are deleted softly, so no DELETE; versions are insert-only, so no UPDATE or DELETE.
REVOKE ALL ON public.landing_page_templates, public.landing_page_template_versions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.landing_page_templates TO authenticated;
GRANT SELECT, INSERT ON public.landing_page_template_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_page_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_page_template_versions TO service_role;

-- Audit the intent: creating, overwriting (current_version changes), renaming and deleting are entries as the admin; the
-- document is logged as changed, never with its content (the versions hold it). updated_at/updated_by alone write nothing.
CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.landing_page_templates
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('landing_page_template', 'id', 'data');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.landing_page_templates
  FOR EACH ROW WHEN ((to_jsonb(OLD) - 'updated_at' - 'updated_by') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at' - 'updated_by'))
  EXECUTE FUNCTION audit_row_change('landing_page_template', 'id', 'data');

-- Save: a new template (no p_template_id) or the next version of an existing one, in one transaction. A name another
-- live template has raises unique_violation; a template that is gone raises not_found.
CREATE FUNCTION public.save_landing_page_template(p_name text, p_description text, p_data jsonb, p_template_id text DEFAULT NULL, p_note text DEFAULT NULL)
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
    INSERT INTO public.landing_page_templates (name, description, data, current_version, created_by, updated_by)
    VALUES (clean_name, clean_description, p_data, 1, auth.uid(), auth.uid())
    RETURNING id, current_version INTO tid, v;
    k := 'created';
  ELSE
    UPDATE public.landing_page_templates
       SET name = clean_name,
           description = clean_description,
           data = p_data,
           current_version = current_version + 1,
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

-- Restore: an earlier version's content becomes the template's current content as a NEW version (history is never
-- rewritten). The template keeps its current name; the description comes back with the content.
CREATE FUNCTION public.restore_landing_page_template_version(p_version_id text)
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

REVOKE ALL ON FUNCTION public.save_landing_page_template(text, text, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_landing_page_template_version(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_landing_page_template(text, text, jsonb, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_landing_page_template_version(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
