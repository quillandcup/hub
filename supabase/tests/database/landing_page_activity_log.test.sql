-- pgTAP tests for 20270822: the page builder in the Activity Log.
--   * saving, overwriting, bringing back, renaming and deleting a template are ONE audit entry each, as the admin (not the service
--     role), and the function that writes the version and updates the template does not make a second one;
--   * a template's typed description and the page's content are never in the entry, and neither is a page's typed search text;
--   * an overwrite and a bring-back are told apart by `last_save_kind` (the sentence reads it), a rename is not a new version;
--   * a refused or stale attempt writes no entry;
--   * the central feed lists those entries (the audit rows) once.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(16);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e7a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tal-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e7a1', 'tal-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Made by the database owner (no signed-in person), so the admin's later change is an entry of its own and is not folded into the insert.
INSERT INTO public.landing_page_templates (id, name, description, data) VALUES
  ('lpgt_TalTest00001', 'Overwrite me', 'secret description', '{"content": [], "root": {}}'),
  ('lpgt_TalTest00002', 'Restore me', '', '{"content": [], "root": {}}'),
  ('lpgt_TalTest00003', 'Rename & <me>', 'secret description', '{"content": [], "root": {}}'),
  ('lpgt_TalTest00004', 'Delete me', '', '{"content": [], "root": {}}');
INSERT INTO public.landing_page_template_versions (id, template_id, version, name, data) VALUES
  ('lpgtv_TalTest0001', 'lpgt_TalTest00001', 1, 'Overwrite me', '{"content": [], "root": {}}'),
  ('lpgtv_TalTest0002', 'lpgt_TalTest00002', 1, 'Restore me', '{"content": [], "root": {}}');
INSERT INTO public.landing_pages (id, slug, title, seo_title) VALUES ('lpg_TalTest000001', 'pgtap-activity-page', 'Activity page', 'Old search words');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e7a1", "email": "tal-admin@example.test", "role": "authenticated"}', true);

-- A refused attempt (a name another template has) and a stale one (a template that is gone) write nothing.
INSERT INTO result SELECT 'clash_refused', to_jsonb(pg_temp.failure($$SELECT * FROM public.save_landing_page_template('overwrite ME', 'Zzdescription', '{"content": [], "root": {}}')$$) <> '');
INSERT INTO result SELECT 'stale_refused', to_jsonb(pg_temp.failure($$SELECT * FROM public.save_landing_page_template('Gone', '', '{"content": [], "root": {}}', 'lpgt_TalTestNone0')$$));

-- One entry each for: a new template, an overwrite, a bring-back, a rename, a delete.
SELECT * FROM public.save_landing_page_template('A new one', 'Zzdescription', '{"content": [{"type": "Heading", "props": {"text": "Zzcontent"}}], "root": {}}', NULL, 'Zznote');
SELECT * FROM public.save_landing_page_template('Overwrite me', 'Zzdescription', '{"content": [{"type": "Heading", "props": {"text": "Zzcontent"}}], "root": {}}', 'lpgt_TalTest00001', 'Zznote');
SELECT * FROM public.restore_landing_page_template_version('lpgtv_TalTest0002');
UPDATE public.landing_page_templates SET name = 'Renamed & <ok>', description = 'Zzdescription' WHERE id = 'lpgt_TalTest00003';
UPDATE public.landing_page_templates SET deleted_at = now() WHERE id = 'lpgt_TalTest00004';
-- The page's typed search words are not logged.
UPDATE public.landing_pages SET seo_title = 'Zzsearch words' WHERE id = 'lpg_TalTest000001';
INSERT INTO result SELECT 'feed_rows', to_jsonb(count(*)) FROM public.get_activity_feed(p_from := now() - interval '1 day', p_limit := 100, p_entity_types := ARRAY['landing_page_template'], p_hide_system := true);
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'clash_refused'), 'true'::jsonb, 'a name another template has is refused');
SELECT is((SELECT value FROM result WHERE label = 'stale_refused'), '"not_found"'::jsonb, 'overwriting a template that is gone is refused');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_type = 'landing_page_template' AND changed_by = '00000000-0000-4000-a000-00000000e7a1'), 5::bigint, 'five intents are five entries, as the admin: a refused or stale attempt writes none');
SELECT is(
  (SELECT jsonb_build_object('kind', actor_kind, 'save', changes #>> '{last_save_kind,new}', 'description', changes #>> '{description,new}', 'data', changes #>> '{data,new}', 'label', entity_label)
     FROM public.audit_log WHERE entity_type = 'landing_page_template' AND action = 'insert' AND changed_by IS NOT NULL),
  jsonb_build_object('kind', 'staff', 'save', 'created', 'description', '[redacted]', 'data', '[redacted]', 'label', 'A new one'),
  'a new template is one entry as the admin, labelled with its name, without its description or content');
SELECT is(
  (SELECT jsonb_build_object('kind', actor_kind, 'version', changes #>> '{current_version,new}', 'save', changes #>> '{last_save_kind,new}', 'label', entity_label)
     FROM public.audit_log WHERE entity_type = 'landing_page_template' AND entity_id = 'lpgt_TalTest00001' AND action = 'update'),
  jsonb_build_object('kind', 'staff', 'version', '2', 'save', 'overwritten', 'label', 'Overwrite me'),
  'an overwrite is one entry that says it was a save over, at version 2');
SELECT is(
  (SELECT jsonb_build_object('version', changes #>> '{current_version,new}', 'save', changes #>> '{last_save_kind,new}')
     FROM public.audit_log WHERE entity_type = 'landing_page_template' AND entity_id = 'lpgt_TalTest00002' AND action = 'update'),
  jsonb_build_object('version', '2', 'save', 'restored'),
  'bringing a version back is one entry that says so, at the new version');
SELECT is(
  (SELECT (changes ? 'name')::text || ':' || (changes ? 'current_version')::text || ':' || (changes ? 'last_save_kind')::text || ':' || (changes #>> '{description,new}')
     FROM public.audit_log WHERE entity_type = 'landing_page_template' AND entity_id = 'lpgt_TalTest00003' AND action = 'update'),
  'true:false:false:[redacted]', 'a rename is an entry that is not a new version, and its description is redacted');
SELECT is(
  (SELECT (changes ? 'deleted_at')::text || ':' || actor_kind FROM public.audit_log WHERE entity_type = 'landing_page_template' AND entity_id = 'lpgt_TalTest00004' AND action = 'update'),
  'true:staff', 'a delete is one entry as the admin');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_type = 'landing_page_template' AND changed_by IS NOT NULL AND (changes - 'id')::text LIKE '%Zz%'), 0::bigint, 'no typed description, note or page content is in any entry');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_type = 'landing_page_template_version'), 0::bigint, 'a version row is not an entry of its own (the template''s entry is the intent)');
SELECT is((SELECT changes #>> '{seo_title,new}' FROM public.audit_log WHERE entity_type = 'landing_page' AND entity_id = 'lpg_TalTest000001' AND action = 'update'), '[redacted]', 'a page''s typed search words are not logged');
SELECT is((SELECT entity_label FROM public.audit_log WHERE entity_type = 'landing_page' AND entity_id = 'lpg_TalTest000001' AND action = 'update'), 'Activity page', 'a page''s entry is labelled with its title');
SELECT is((SELECT value FROM result WHERE label = 'feed_rows'), '5'::jsonb, 'the central feed lists each of the five entries once');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_type = 'landing_page_template' AND changed_by IS NOT NULL AND actor_kind = 'system'), 0::bigint, 'none of them is recorded as the system');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_type = 'landing_page_template' AND entity_id = 'lpgt_TalTest00002' AND action = 'insert'), 1::bigint, 'the seeded template has only its own creation entry besides the bring-back');
SELECT is((SELECT count(*) FROM public.landing_page_template_versions WHERE template_id = 'lpgt_TalTest00001'), 2::bigint, 'the overwrite kept the old version beside the new one');

SELECT * FROM finish(true);
ROLLBACK;
