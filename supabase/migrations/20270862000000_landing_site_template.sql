set lock_timeout = '5s';

-- The site template (docs/LANDING_PAGES.md, "Site template"): the one header and footer that every website page shares, kept as a
-- draft the Design view autosaves and a published copy the public website pages render. One row for the whole site. Publishing is a
-- separate, explicit step, so an edit never changes a live page by accident. Admin only: a signed-out visitor never reads this table;
-- the public route reads the published copy on the server with the service role. Tier 2 id: never in a URL.

CREATE TABLE public.landing_site_template (
  id text PRIMARY KEY DEFAULT public.new_id('lpst'),
  -- A constant that is always true and unique: the table holds at most one row.
  singleton boolean NOT NULL DEFAULT true CHECK (singleton) UNIQUE,
  draft_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_data jsonb,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE public.landing_site_template IS
  'LOCAL: The site-wide header and footer shared by every website page of the page builder: a draft (autosaved, not audited) and a published copy (what public website pages render). One row. Admin only. [id prefix: lpst_]';

ALTER TABLE public.landing_site_template ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read the site template" ON public.landing_site_template
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins create the site template" ON public.landing_site_template
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins change the site template" ON public.landing_site_template
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- No anon grants, and no DELETE: the row is kept for the life of the site.
REVOKE ALL ON public.landing_site_template FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.landing_site_template TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_site_template TO service_role;

-- Audit the intent, not the keystrokes: autosaving the draft writes nothing; publishing does. Neither document is ever logged.
CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.landing_site_template
  FOR EACH ROW WHEN (NEW.published_at IS NOT NULL)
  EXECUTE FUNCTION audit_row_change('landing_site_template', 'id', 'draft_data,published_data');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.landing_site_template
  FOR EACH ROW WHEN ((to_jsonb(OLD) - 'draft_data' - 'updated_at' - 'updated_by') IS DISTINCT FROM (to_jsonb(NEW) - 'draft_data' - 'updated_at' - 'updated_by'))
  EXECUTE FUNCTION audit_row_change('landing_site_template', 'id', 'draft_data,published_data');

NOTIFY pgrst, 'reload schema';
