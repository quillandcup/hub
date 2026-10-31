-- pgTAP tests for the course editor's write rules (20270315000000): an admin creates and edits Hub-owned
-- courses (source = 'hub') with their own client, which writes the audit log as them; a course imported from
-- Kajabi, and anyone who isn't an admin, can't be written. Runs in one transaction that is rolled back, so
-- it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(13);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e0a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'editor-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e0a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'editor-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e0a1', 'editor-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e0a4', 'editor-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- A course imported from Kajabi, which no one may write here, and two Hub-owned ones for the admin to
-- edit and delete. (The audit trigger folds a record's insert, update and delete within one transaction
-- into their net effect, so each audited action is tested on a different row.)
INSERT INTO public.courses (id, slug, title, source, source_key) VALUES
  ('crs_EditorKajabi1', 'pgtap-editor-kajabi', 'Imported Course', 'kajabi', 'pgtap-editor-kajabi');
INSERT INTO public.courses (id, slug, title, source) VALUES
  ('crs_EditorEdited1', 'pgtap-editor-edited', 'To Edit', 'hub'),
  ('crs_EditorDelete1', 'pgtap-editor-delete', 'To Delete', 'hub');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- Records whether a statement was refused (RLS or a privilege) rather than letting the exception stop the test.
CREATE FUNCTION pg_temp.refused(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.refused(text) TO authenticated;

SET LOCAL ROLE authenticated;

-- Alice (a member) can't create a course, Hub-owned or not.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e0a1", "email": "editor-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_create_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.courses (slug, title, source) VALUES ('pgtap-editor-alice', 'Alice''s Course', 'hub')$$));

-- Dana (an admin) creates, edits and deletes a Hub-owned course, but can't touch the Kajabi one.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e0a4", "email": "editor-dana@example.test", "role": "authenticated"}', true);
INSERT INTO public.courses (slug, title, source, kind) VALUES ('pgtap-editor-hub', 'Hub Course', 'hub', 'evergreen');
INSERT INTO result SELECT 'admin_hub_course_id_is_short', to_jsonb(id LIKE 'crs\_%') FROM public.courses WHERE slug = 'pgtap-editor-hub';
UPDATE public.courses SET title = 'Hub Course, renamed' WHERE slug = 'pgtap-editor-hub';
INSERT INTO result SELECT 'admin_edit_took', to_jsonb(title) FROM public.courses WHERE slug = 'pgtap-editor-hub';
INSERT INTO result SELECT 'admin_create_kajabi_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.courses (slug, title, source, source_key) VALUES ('pgtap-editor-sneaky', 'Sneaky', 'kajabi', 'pgtap-editor-sneaky')$$));
INSERT INTO result SELECT 'admin_make_hub_course_kajabi_refused', to_jsonb(pg_temp.refused($$UPDATE public.courses SET source = 'kajabi' WHERE slug = 'pgtap-editor-hub'$$));
UPDATE public.courses SET title = 'Hacked' WHERE id = 'crs_EditorKajabi1';
INSERT INTO result SELECT 'kajabi_title_after_admin_update', to_jsonb(title) FROM public.courses WHERE id = 'crs_EditorKajabi1';
DELETE FROM public.courses WHERE id = 'crs_EditorKajabi1';
INSERT INTO result SELECT 'kajabi_course_survives_admin_delete', to_jsonb(count(*)) FROM public.courses WHERE id = 'crs_EditorKajabi1';
UPDATE public.courses SET title = 'To Edit, renamed' WHERE id = 'crs_EditorEdited1';
DELETE FROM public.courses WHERE id = 'crs_EditorDelete1';
INSERT INTO result SELECT 'hub_course_deleted', to_jsonb(count(*)) FROM public.courses WHERE id = 'crs_EditorDelete1';
RESET ROLE;

-- The service role (no auth.uid()) rewrites an imported course, as the Kajabi sync does.
UPDATE public.courses SET title = 'Imported Course, resynced' WHERE id = 'crs_EditorKajabi1';

SELECT is((SELECT value FROM result WHERE label = 'member_create_refused'), 'true'::jsonb, 'a member can''t create a course');
SELECT is((SELECT value FROM result WHERE label = 'admin_hub_course_id_is_short'), 'true'::jsonb, 'a created course gets a short crs_ id');
SELECT is((SELECT value FROM result WHERE label = 'admin_edit_took'), '"Hub Course, renamed"'::jsonb, 'an admin edits a Hub-owned course');
SELECT is((SELECT value FROM result WHERE label = 'admin_create_kajabi_refused'), 'true'::jsonb, 'an admin can''t create a Kajabi-owned course');
SELECT is((SELECT value FROM result WHERE label = 'admin_make_hub_course_kajabi_refused'), 'true'::jsonb, 'an admin can''t hand a Hub course to the Kajabi sync');
SELECT is((SELECT value FROM result WHERE label = 'kajabi_title_after_admin_update'), '"Imported Course"'::jsonb, 'an admin can''t edit an imported course');
SELECT is((SELECT value FROM result WHERE label = 'kajabi_course_survives_admin_delete'), '1'::jsonb, 'an admin can''t delete an imported course');
SELECT is((SELECT value FROM result WHERE label = 'hub_course_deleted'), '0'::jsonb, 'an admin deletes a Hub-owned course');

-- The created course's insert and rename in one transaction fold into one row with the final title.
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course' AND action = 'insert' AND entity_label = 'Hub Course, renamed' AND changed_by = '00000000-0000-4000-a000-00000000e0a4'),
  1, 'creating a course is audited as the admin, labelled with its title');
SELECT is(
  (SELECT actor_kind FROM public.audit_log WHERE entity_type = 'course' AND action = 'insert' AND entity_label = 'Hub Course, renamed'),
  'staff', 'the audit row says staff, not system');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course' AND entity_id = 'crs_EditorEdited1' AND action = 'update' AND changes ? 'title' AND changed_by = '00000000-0000-4000-a000-00000000e0a4'),
  1, 'editing a course is audited as the admin, with the title change');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course' AND entity_id = 'crs_EditorDelete1' AND action = 'delete' AND changed_by = '00000000-0000-4000-a000-00000000e0a4'),
  1, 'deleting a course is audited as the admin');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course' AND entity_id = 'crs_EditorKajabi1'),
  0, 'the Kajabi sync rewriting an imported course is not audited (it would bury the edits)');

SELECT * FROM finish(true);
ROLLBACK;
