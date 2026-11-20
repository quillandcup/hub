-- pgTAP tests for saved page-builder templates (20270821): only admins read or write templates and their versions (a
-- member and a signed-out visitor get nothing, and neither does a community manager), a template's name is unique among
-- live templates whatever its case and a deleted template frees it, saving numbers versions 1, 2, 3 and keeps the old
-- ones, the template's current content is always its latest version, bringing a version back makes a NEW version, and
-- the audit log records create, overwrite, rename and delete as the admin without the page's content. Runs in one
-- transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(40);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e6a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tpl-member@example.test'),
  ('00000000-0000-4000-a000-00000000e6a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tpl-admin@example.test'),
  ('00000000-0000-4000-a000-00000000e6a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tpl-manager@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e6a1', 'tpl-member@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e6a2', 'tpl-admin@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000e6a3', 'tpl-manager@example.test', 'community_manager')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Made as the database owner, so the admin's own changes below are a separate audit story from its creation.
INSERT INTO public.landing_page_templates (id, name, description, data) VALUES
  ('lpgt_TplTest00001', 'Seeded template', '', '{"content": [], "root": {}}'),
  ('lpgt_TplTest00002', 'Seeded to rename', '', '{"content": [], "root": {}}'),
  ('lpgt_TplTest00003', 'Seeded to delete', '', '{"content": [], "root": {}}'),
  ('lpgt_TplTest00004', 'Seeded to touch', '', '{"content": [], "root": {}}');
INSERT INTO public.landing_page_template_versions (id, template_id, version, name, data) VALUES
  ('lpgtv_TplTest0001', 'lpgt_TplTest00001', 1, 'Seeded template', '{"content": [], "root": {}}');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, anon, service_role;

CREATE FUNCTION pg_temp.refused(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege OR check_violation OR unique_violation OR foreign_key_violation THEN
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.refused(text) TO authenticated, anon;

CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated, anon;

-- A signed-out visitor.
SET LOCAL ROLE anon;
INSERT INTO result SELECT 'anon_templates_refused', to_jsonb(pg_temp.refused($$SELECT count(*) FROM public.landing_page_templates$$));
INSERT INTO result SELECT 'anon_versions_refused', to_jsonb(pg_temp.refused($$SELECT count(*) FROM public.landing_page_template_versions$$));
RESET ROLE;

-- A member and a community manager (staff, but not admins: new roles opt in).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e6a1", "email": "tpl-member@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_sees', to_jsonb(count(*)) FROM public.landing_page_templates;
INSERT INTO result SELECT 'member_versions_see', to_jsonb(count(*)) FROM public.landing_page_template_versions;
INSERT INTO result SELECT 'member_insert_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_page_templates (name, data) VALUES ('Mine', '{}')$$));
INSERT INTO result SELECT 'member_save_message', to_jsonb(pg_temp.failure($$SELECT * FROM public.save_landing_page_template('Member made', '', '{"content": [], "root": {}}', NULL, NULL)$$));
UPDATE public.landing_page_templates SET name = 'Hacked' WHERE id = 'lpgt_TplTest00001';
RESET ROLE;
INSERT INTO result SELECT 'name_after_member', to_jsonb(name) FROM public.landing_page_templates WHERE id = 'lpgt_TplTest00001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e6a3", "email": "tpl-manager@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'manager_sees', to_jsonb(count(*)) FROM public.landing_page_templates;
INSERT INTO result SELECT 'manager_save_message', to_jsonb(pg_temp.failure($$SELECT * FROM public.save_landing_page_template('Manager made', '', '{"content": [], "root": {}}', NULL, NULL)$$));
RESET ROLE;

-- An admin.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e6a2", "email": "tpl-admin@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.landing_page_templates;

-- Audit stories, one seeded template each (the audit trigger folds one transaction's changes to a row into one entry).
SELECT * FROM public.save_landing_page_template('Seeded template', '', '{"content": [{"type": "Heading", "props": {"text": "Zzaudit"}}], "root": {}}', 'lpgt_TplTest00001', 'Zznote');
UPDATE public.landing_page_templates SET name = 'Seeded, renamed' WHERE id = 'lpgt_TplTest00002';
UPDATE public.landing_page_templates SET deleted_at = now() WHERE id = 'lpgt_TplTest00003';
UPDATE public.landing_page_templates SET updated_at = now(), updated_by = '00000000-0000-4000-a000-00000000e6a2' WHERE id = 'lpgt_TplTest00004';

-- A new template is version 1, with short ids, and its content is that version's.
INSERT INTO result SELECT 'saved_new', to_jsonb(saved_version) FROM public.save_landing_page_template('  Spring launch  ', 'A short one', '{"content": [{"type": "Heading", "props": {"text": "Zzfirst"}}], "root": {}}', NULL, NULL);
INSERT INTO result SELECT 'template_id_short', to_jsonb(id LIKE 'lpgt\_%' AND name = 'Spring launch') FROM public.landing_page_templates WHERE lower(name) = 'spring launch';
INSERT INTO result SELECT 'version_id_short', to_jsonb(bool_and(id LIKE 'lpgtv\_%')) FROM public.landing_page_template_versions WHERE name = 'Spring launch';
INSERT INTO result SELECT 'first_kind', to_jsonb(kind || ':' || version) FROM public.landing_page_template_versions WHERE name = 'Spring launch';

-- The name is unique among live templates, whatever its case.
INSERT INTO result SELECT 'name_clash_refused', to_jsonb(pg_temp.refused($$SELECT * FROM public.save_landing_page_template('SPRING LAUNCH', '', '{"content": [], "root": {}}', NULL, NULL)$$));
INSERT INTO result SELECT 'name_clash_left_no_version', to_jsonb(count(*)) FROM public.landing_page_template_versions WHERE lower(name) = 'spring launch';

-- Overwriting is version 2; version 1 is kept; the template's content is version 2's.
INSERT INTO result
  SELECT 'saved_over', to_jsonb(saved_version)
    FROM public.save_landing_page_template('Spring launch', 'A better one', '{"content": [{"type": "Heading", "props": {"text": "Zzsecond"}}], "root": {}}', (SELECT id FROM public.landing_page_templates WHERE name = 'Spring launch'), 'Fixed the headline');
INSERT INTO result SELECT 'versions_kept', to_jsonb(array_agg(version || ':' || kind || ':' || COALESCE(note, '') ORDER BY version)) FROM public.landing_page_template_versions WHERE name = 'Spring launch';
INSERT INTO result SELECT 'old_version_content', to_jsonb(data #>> '{content,0,props,text}') FROM public.landing_page_template_versions WHERE name = 'Spring launch' AND version = 1;
INSERT INTO result
  SELECT 'current_is_latest', to_jsonb(t.current_version = (SELECT max(version) FROM public.landing_page_template_versions v WHERE v.template_id = t.id) AND t.data = (SELECT data FROM public.landing_page_template_versions v WHERE v.template_id = t.id AND v.version = t.current_version))
    FROM public.landing_page_templates t WHERE t.name = 'Spring launch';
INSERT INTO result SELECT 'overwrite_missing_message', to_jsonb(pg_temp.failure($$SELECT * FROM public.save_landing_page_template('Nope', '', '{"content": [], "root": {}}', 'lpgt_TplTestNone0', NULL)$$));

-- Bringing version 1 back is version 3 (a new version, never a rewrite); the name stays as it is now.
UPDATE public.landing_page_templates SET name = 'Spring launch, renamed' WHERE name = 'Spring launch';
INSERT INTO result SELECT 'restored', to_jsonb(saved_version) FROM public.restore_landing_page_template_version((SELECT id FROM public.landing_page_template_versions WHERE name = 'Spring launch' AND version = 1));
INSERT INTO result SELECT 'restored_content', to_jsonb(data #>> '{content,0,props,text}' || ':' || name || ':' || current_version) FROM public.landing_page_templates WHERE name = 'Spring launch, renamed';
INSERT INTO result
  SELECT 'restored_version_row', to_jsonb(kind || ':' || restored_from_version || ':' || name)
    FROM public.landing_page_template_versions WHERE version = 3 AND template_id = (SELECT id FROM public.landing_page_templates WHERE name = 'Spring launch, renamed');
INSERT INTO result SELECT 'history_intact', to_jsonb(count(*)) FROM public.landing_page_template_versions WHERE template_id = (SELECT id FROM public.landing_page_templates WHERE name = 'Spring launch, renamed') AND version IN (1, 2) AND data #>> '{content,0,props,text}' IN ('Zzfirst', 'Zzsecond');
INSERT INTO result SELECT 'restore_missing_message', to_jsonb(pg_temp.failure($$SELECT * FROM public.restore_landing_page_template_version('lpgtv_TplTestNone')$$));

-- Versions are insert-only for the app: no update, no delete.
INSERT INTO result SELECT 'version_update_refused', to_jsonb(pg_temp.refused($$UPDATE public.landing_page_template_versions SET note = 'x'$$));
INSERT INTO result SELECT 'version_delete_refused', to_jsonb(pg_temp.refused($$DELETE FROM public.landing_page_template_versions$$));
INSERT INTO result SELECT 'bad_kind_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_page_template_versions (template_id, version, name, data, kind) VALUES ('lpgt_TplTest00001', 9, 'x', '{}', 'other')$$));
INSERT INTO result SELECT 'duplicate_version_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_page_template_versions (template_id, version, name, data) VALUES ('lpgt_TplTest00001', 1, 'x', '{}')$$));
INSERT INTO result SELECT 'blank_name_refused', to_jsonb(pg_temp.refused($$SELECT * FROM public.save_landing_page_template('   ', '', '{"content": [], "root": {}}', NULL, NULL)$$));

-- Deleting (soft) frees the name; the versions stay.
UPDATE public.landing_page_templates SET deleted_at = now() WHERE name = 'Spring launch, renamed';
INSERT INTO result SELECT 'name_freed', to_jsonb(saved_version) FROM public.save_landing_page_template('spring launch, RENAMED', '', '{"content": [], "root": {}}', NULL, NULL);
INSERT INTO result SELECT 'versions_survive_delete', to_jsonb(count(*)) FROM public.landing_page_template_versions v JOIN public.landing_page_templates t ON t.id = v.template_id WHERE t.deleted_at IS NOT NULL AND t.name = 'Spring launch, renamed';
INSERT INTO result SELECT 'restore_of_deleted_refused', to_jsonb(pg_temp.failure($$SELECT * FROM public.restore_landing_page_template_version((SELECT v.id FROM public.landing_page_template_versions v JOIN public.landing_page_templates t ON t.id = v.template_id WHERE t.deleted_at IS NOT NULL AND t.name = 'Spring launch, renamed' AND v.version = 1))$$));
RESET ROLE;

-- The server's role reads them (the service role runs scripts and the in-process repositories).
SET LOCAL ROLE service_role;
INSERT INTO result SELECT 'service_reads', to_jsonb(count(*) > 0) FROM public.landing_page_templates;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'anon_templates_refused'), 'true'::jsonb, 'a signed-out visitor can''t read templates');
SELECT is((SELECT value FROM result WHERE label = 'anon_versions_refused'), 'true'::jsonb, 'a signed-out visitor can''t read template versions');
SELECT is((SELECT value FROM result WHERE label = 'member_sees'), '0'::jsonb, 'a member sees no templates');
SELECT is((SELECT value FROM result WHERE label = 'member_versions_see'), '0'::jsonb, 'a member sees no template versions');
SELECT is((SELECT value FROM result WHERE label = 'member_insert_refused'), 'true'::jsonb, 'a member can''t add a template');
SELECT is((SELECT value FROM result WHERE label = 'member_save_message'), '"new row violates row-level security policy for table \"landing_page_templates\""'::jsonb, 'a member can''t save a template');
SELECT is((SELECT value FROM result WHERE label = 'name_after_member'), '"Seeded template"'::jsonb, 'a member can''t change a template');
SELECT is((SELECT value FROM result WHERE label = 'manager_sees'), '0'::jsonb, 'a community manager sees no templates (admins only)');
SELECT is((SELECT value FROM result WHERE label = 'manager_save_message'), '"new row violates row-level security policy for table \"landing_page_templates\""'::jsonb, 'a community manager can''t save a template');
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '4'::jsonb, 'an admin sees the templates');
SELECT is((SELECT value FROM result WHERE label = 'saved_new'), '1'::jsonb, 'a new template is version 1');
SELECT is((SELECT value FROM result WHERE label = 'template_id_short'), 'true'::jsonb, 'a template gets a short lpgt_ id and a trimmed name');
SELECT is((SELECT value FROM result WHERE label = 'version_id_short'), 'true'::jsonb, 'a version gets a short lpgtv_ id');
SELECT is((SELECT value FROM result WHERE label = 'first_kind'), '"created:1"'::jsonb, 'the first version is a created one');
SELECT is((SELECT value FROM result WHERE label = 'name_clash_refused'), 'true'::jsonb, 'a name another live template has is refused, whatever its case');
SELECT is((SELECT value FROM result WHERE label = 'name_clash_left_no_version'), '1'::jsonb, 'a refused save leaves no version behind');
SELECT is((SELECT value FROM result WHERE label = 'saved_over'), '2'::jsonb, 'overwriting makes version 2');
SELECT is((SELECT value FROM result WHERE label = 'versions_kept'), '["1:created:", "2:overwritten:Fixed the headline"]'::jsonb, 'overwriting keeps version 1 and records the note');
SELECT is((SELECT value FROM result WHERE label = 'old_version_content'), '"Zzfirst"'::jsonb, 'the old version keeps its own content');
SELECT is((SELECT value FROM result WHERE label = 'current_is_latest'), 'true'::jsonb, 'a template''s content is always its latest version');
SELECT is((SELECT value FROM result WHERE label = 'overwrite_missing_message'), '"not_found"'::jsonb, 'overwriting a template that doesn''t exist is refused');
SELECT is((SELECT value FROM result WHERE label = 'restored'), '3'::jsonb, 'bringing a version back makes a new version');
SELECT is((SELECT value FROM result WHERE label = 'restored_content'), '"Zzfirst:Spring launch, renamed:3"'::jsonb, 'the restored content is current and the name stays');
SELECT is((SELECT value FROM result WHERE label = 'restored_version_row'), '"restored:1:Spring launch, renamed"'::jsonb, 'the new version says which one it came from');
SELECT is((SELECT value FROM result WHERE label = 'history_intact'), '2'::jsonb, 'bringing a version back leaves versions 1 and 2 as they were');
SELECT is((SELECT value FROM result WHERE label = 'restore_missing_message'), '"not_found"'::jsonb, 'restoring a version that doesn''t exist is refused');

SELECT is((SELECT value FROM result WHERE label = 'version_update_refused'), 'true'::jsonb, 'a version can''t be changed');
SELECT is((SELECT value FROM result WHERE label = 'version_delete_refused'), 'true'::jsonb, 'a version can''t be deleted');
SELECT is((SELECT value FROM result WHERE label = 'bad_kind_refused'), 'true'::jsonb, 'a version is created, overwritten or restored');
SELECT is((SELECT value FROM result WHERE label = 'duplicate_version_refused'), 'true'::jsonb, 'a template has one version of each number');
SELECT is((SELECT value FROM result WHERE label = 'blank_name_refused'), 'true'::jsonb, 'a template needs a name');
SELECT is((SELECT value FROM result WHERE label = 'name_freed'), '1'::jsonb, 'a deleted template frees its name');
SELECT is((SELECT value FROM result WHERE label = 'versions_survive_delete'), '3'::jsonb, 'deleting a template keeps its versions');
SELECT is((SELECT value FROM result WHERE label = 'restore_of_deleted_refused'), '"not_found"'::jsonb, 'a deleted template''s version can''t be brought back');
SELECT is((SELECT value FROM result WHERE label = 'service_reads'), 'true'::jsonb, 'the service role reads templates');

-- Audit: each as the admin, the content never in it.
SELECT is(
  (SELECT jsonb_build_object('who', changed_by, 'kind', actor_kind, 'version', changes #>> '{current_version,new}', 'data', changes #>> '{data,new}', 'leak', (changes - 'id')::text LIKE '%Zz%')
     FROM public.audit_log WHERE entity_type = 'landing_page_template' AND entity_id = 'lpgt_TplTest00001' AND action = 'update'),
  jsonb_build_object('who', '00000000-0000-4000-a000-00000000e6a2'::text, 'kind', 'staff', 'version', '2', 'data', '[redacted]', 'leak', false),
  'overwriting a template is one audit entry as the admin, without the page''s content');
SELECT is(
  (SELECT (changes ? 'name')::text || ':' || (changes ? 'current_version')::text || ':' || (changes #>> '{name,new}')
     FROM public.audit_log WHERE entity_type = 'landing_page_template' AND entity_id = 'lpgt_TplTest00002' AND action = 'update'),
  'true:false:Seeded, renamed', 'renaming a template is an audit entry that is not a new version');
SELECT is(
  (SELECT (changes ? 'deleted_at')::text || ':' || actor_kind FROM public.audit_log WHERE entity_type = 'landing_page_template' AND entity_id = 'lpgt_TplTest00003' AND action = 'update'),
  'true:staff', 'deleting a template is an audit entry as the admin');
SELECT is(
  (SELECT count(*) FROM public.audit_log WHERE entity_type = 'landing_page_template' AND entity_id = 'lpgt_TplTest00004' AND action = 'update'),
  0::bigint, 'touching only updated_at and updated_by writes no audit entry');
SELECT is(
  (SELECT jsonb_build_object('who', changed_by, 'data', changes #>> '{data,new}', 'leak', (changes - 'id')::text LIKE '%Zz%')
     FROM public.audit_log a JOIN public.landing_page_templates t ON t.id = a.entity_id WHERE a.entity_type = 'landing_page_template' AND a.action = 'insert' AND t.name = 'Spring launch, renamed'),
  jsonb_build_object('who', '00000000-0000-4000-a000-00000000e6a2'::text, 'data', '[redacted]', 'leak', false),
  'creating a template is an audit entry as the admin, without the page''s content');

SELECT * FROM finish(true);
ROLLBACK;
