-- pgTAP tests for 20270824 (docs/product/LANDING_PAGES.md, "Templates"): a landing page has a kind, page or template, that never changes;
-- a template's changes are Activity Log entries of their own type without page content; and the versions are immutable: no one,
-- not an admin and not the service role, can change or delete a version, and a publish adds exactly one row and leaves
-- every earlier one byte for byte as it was. Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(14);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e8a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kind-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e8a2', 'kind-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, service_role;

CREATE FUNCTION pg_temp.refused(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege OR check_violation OR unique_violation OR foreign_key_violation THEN
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.refused(text) TO authenticated, service_role;

CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated, service_role;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e8a2", "email": "kind-admin@example.test", "role": "authenticated"}', true);

INSERT INTO public.landing_pages (id, slug, title, draft_data) VALUES
  ('lpg_KindTest00001', 'pgtap-kind-page', 'A page', '{"content": [{"type": "Heading", "props": {"text": "Zzpage"}}], "root": {}}');
INSERT INTO public.landing_pages (id, slug, title, kind, draft_data) VALUES
  ('lpg_KindTest00002', 'pgtap-kind-template', 'A template', 'template', '{"content": [{"type": "Heading", "props": {"text": "Zztemplate"}}], "root": {}}');
INSERT INTO result SELECT 'default_kind', to_jsonb(kind) FROM public.landing_pages WHERE id = 'lpg_KindTest00001';
INSERT INTO result SELECT 'bad_kind_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_pages (slug, title, kind) VALUES ('pgtap-kind-bad', 'Bad', 'draft')$$));
INSERT INTO result SELECT 'kind_change_message', to_jsonb(pg_temp.failure($$UPDATE public.landing_pages SET kind = 'page' WHERE id = 'lpg_KindTest00002'$$));
INSERT INTO result SELECT 'kind_unchanged', to_jsonb(kind) FROM public.landing_pages WHERE id = 'lpg_KindTest00002';

-- Publishing adds exactly one version row and leaves earlier ones as they were.
SELECT public.publish_landing_page('lpg_KindTest00001');
CREATE TEMP TABLE snap ON COMMIT DROP AS SELECT id, md5(v::text) AS h FROM public.landing_page_versions v;
GRANT SELECT ON snap TO authenticated;
INSERT INTO result SELECT 'rows_before', to_jsonb(count(*)) FROM snap;
SELECT public.publish_landing_page('lpg_KindTest00001');
SELECT public.publish_landing_page('lpg_KindTest00002');
INSERT INTO result SELECT 'rows_after', to_jsonb(count(*)) FROM public.landing_page_versions;
INSERT INTO result SELECT 'earlier_rows_changed', to_jsonb(count(*)) FROM snap s JOIN public.landing_page_versions v ON v.id = s.id WHERE md5(v::text) <> s.h;

-- A page's typed search words are not logged.
UPDATE public.landing_pages SET seo_title = 'Zzsearch words' WHERE id = 'lpg_KindTest00001';

-- No one changes or deletes a version.
INSERT INTO result SELECT 'admin_update_refused', to_jsonb(pg_temp.refused($$UPDATE public.landing_page_versions SET title = 'x'$$));
INSERT INTO result SELECT 'admin_delete_refused', to_jsonb(pg_temp.refused($$DELETE FROM public.landing_page_versions$$));
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO result SELECT 'service_update_refused', to_jsonb(pg_temp.refused($$UPDATE public.landing_page_versions SET title = 'x'$$));
INSERT INTO result SELECT 'service_delete_refused', to_jsonb(pg_temp.refused($$DELETE FROM public.landing_page_versions$$));
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'default_kind'), '"page"'::jsonb, 'a page made without a kind is a page');
SELECT is((SELECT value FROM result WHERE label = 'bad_kind_refused'), 'true'::jsonb, 'a kind is page or template');
SELECT is((SELECT value FROM result WHERE label = 'kind_change_message'), '"landing_page_kind_is_fixed"'::jsonb, 'a page can''t become a template or back');
SELECT is((SELECT value FROM result WHERE label = 'kind_unchanged'), '"template"'::jsonb, 'a refused change leaves the kind as it was');
SELECT is(
  (SELECT jsonb_build_object('type', entity_type, 'who', changed_by, 'leak', changes::text LIKE '%Zz%', 'status', changes #>> '{status,new}', 'label', entity_label)
     FROM public.audit_log WHERE entity_id = 'lpg_KindTest00002'),
  jsonb_build_object('type', 'landing_page_template', 'who', '00000000-0000-4000-a000-00000000e8a2'::text, 'leak', false, 'status', 'published', 'label', 'A template'),
  'a template''s creation and publish are one entry of its own type, as the admin, without its content');
SELECT is(
  (SELECT jsonb_build_object('type', entity_type, 'leak', changes::text LIKE '%Zz%') FROM public.audit_log WHERE entity_id = 'lpg_KindTest00001'),
  jsonb_build_object('type', 'landing_page', 'leak', false),
  'a page''s entry keeps its own type, without its content');
SELECT is((SELECT changes #>> '{seo_title,new}' FROM public.audit_log WHERE entity_id = 'lpg_KindTest00001'), '[redacted]', 'a page''s typed search words are redacted from its entry');
SELECT is((SELECT value FROM result WHERE label = 'rows_after'), ((SELECT value FROM result WHERE label = 'rows_before')::text::int + 2)::text::jsonb, 'each publish adds exactly one version row');
SELECT is((SELECT value FROM result WHERE label = 'earlier_rows_changed'), '0'::jsonb, 'earlier versions are byte for byte as they were');
SELECT is((SELECT value FROM result WHERE label = 'admin_update_refused'), 'true'::jsonb, 'an admin can''t change a version');
SELECT is((SELECT value FROM result WHERE label = 'admin_delete_refused'), 'true'::jsonb, 'an admin can''t delete a version');
SELECT is((SELECT value FROM result WHERE label = 'service_update_refused'), 'true'::jsonb, 'the service role can''t change a version');
SELECT is((SELECT value FROM result WHERE label = 'service_delete_refused'), 'true'::jsonb, 'the service role can''t delete a version');
SELECT is((SELECT count(*) FROM public.landing_page_versions WHERE page_id IN ('lpg_KindTest00001', 'lpg_KindTest00002')), 3::bigint, 'the page has two versions and the template one');

SELECT * FROM finish(true);
ROLLBACK;
