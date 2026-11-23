-- pgTAP tests for 20270862 (docs/product/LANDING_PAGES.md, "Site template"): the one-row table holding the header and footer that website
-- pages share. Admin only (no anon, no member), a single row, autosaving the draft writes no audit entry, publishing writes one
-- without either document. Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'site-member@example.test'),
  ('00000000-0000-4000-a000-00000000f1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'site-admin@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', 'site-member@example.test'),
  ('00000000-0000-4000-a000-00000000f1a2', 'site-admin@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000f1a2', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, service_role, anon;

CREATE FUNCTION pg_temp.refused(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege OR check_violation OR unique_violation OR foreign_key_violation THEN
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.refused(text) TO authenticated, service_role, anon;

-- A signed-out visitor.
SET LOCAL ROLE anon;
INSERT INTO result SELECT 'anon_refused', to_jsonb(pg_temp.refused($$SELECT count(*) FROM public.landing_site_template$$));
RESET ROLE;

-- The table holds one row, and the repository tests leave theirs behind: start from none (rolled back with the rest).
DELETE FROM public.landing_site_template;
INSERT INTO public.landing_site_template (id, draft_data) VALUES ('lpst_SiteTest0001', '{"header": {"show": true}}');

-- A member sees nothing and changes nothing.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "site-member@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_sees', to_jsonb(count(*)) FROM public.landing_site_template;
UPDATE public.landing_site_template SET draft_data = '{"hacked": true}';
RESET ROLE;
INSERT INTO result SELECT 'draft_after_member', draft_data FROM public.landing_site_template;

-- An admin: the table holds one row; autosave is not audited; publishing is, without the documents.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a2", "email": "site-admin@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.landing_site_template;
INSERT INTO result SELECT 'second_row_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_site_template (draft_data) VALUES ('{}')$$));
UPDATE public.landing_site_template SET draft_data = '{"header": {"show": true, "text": "Zzdraft"}}', updated_at = now(), updated_by = '00000000-0000-4000-a000-00000000f1a2';
INSERT INTO result SELECT 'autosave_audit_rows', to_jsonb(count(*)) FROM public.audit_log WHERE entity_type = 'landing_site_template' AND entity_id = 'lpst_SiteTest0001' AND action = 'update';
UPDATE public.landing_site_template SET published_data = draft_data, published_at = now(), published_by = '00000000-0000-4000-a000-00000000f1a2', updated_at = now();
INSERT INTO result SELECT 'publish_audit', to_jsonb((SELECT count(*) FROM public.audit_log WHERE entity_type = 'landing_site_template' AND entity_id = 'lpst_SiteTest0001' AND action = 'update' AND changes ? 'published_at' AND changes::text NOT LIKE '%Zzdraft%'));
RESET ROLE;
INSERT INTO result SELECT 'id_short', to_jsonb(id LIKE 'lpst\_%') FROM public.landing_site_template;

SELECT is((SELECT value FROM result WHERE label = 'anon_refused'), 'true'::jsonb, 'a signed-out visitor can''t read the site template');
SELECT is((SELECT value FROM result WHERE label = 'member_sees'), '0'::jsonb, 'a member sees no site template');
SELECT is((SELECT value FROM result WHERE label = 'draft_after_member'), '{"header": {"show": true}}'::jsonb, 'a member can''t change it');
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '1'::jsonb, 'an admin sees it');
SELECT is((SELECT value FROM result WHERE label = 'second_row_refused'), 'true'::jsonb, 'a second row is refused');
SELECT is((SELECT value FROM result WHERE label = 'autosave_audit_rows'), '0'::jsonb, 'autosaving the draft writes no audit entry');
SELECT is((SELECT value FROM result WHERE label = 'publish_audit'), '1'::jsonb, 'publishing is one audit entry without the documents');
SELECT is((SELECT value FROM result WHERE label = 'id_short'), 'true'::jsonb, 'the id carries the lpst_ prefix');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'landing_site_template' AND entity_id = 'lpst_SiteTest0001' AND changes::text LIKE '%Zzdraft%'), 0, 'neither document is logged');

SELECT * FROM finish(true);
ROLLBACK;
