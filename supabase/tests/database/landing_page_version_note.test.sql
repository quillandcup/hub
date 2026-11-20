-- pgTAP tests for 20270827: a version's note. Publishing with a note writes it (trimmed) on the version it makes, in the same step;
-- a blank note is no note; the one-argument publish still works and leaves the note empty; a note is at most 200 characters; and the
-- note is never in the audit log (the intent is logged, the note stays with the version). Runs in one transaction that is
-- rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e9a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'note-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e9a2', 'note-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

CREATE FUNCTION pg_temp.refused(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege OR check_violation OR unique_violation OR foreign_key_violation THEN
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.refused(text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e9a2", "email": "note-admin@example.test", "role": "authenticated"}', true);

INSERT INTO public.landing_pages (id, slug, title, draft_data) VALUES
  ('lpg_NoteTest00001', 'pgtap-note-page', 'Note page', '{"content": [{"type": "Heading", "props": {"text": "Zzcontent"}}], "root": {}}');
SELECT public.publish_landing_page_with_note('lpg_NoteTest00001', '  Fixed the Zznote  ');
SELECT public.publish_landing_page_with_note('lpg_NoteTest00001', '   ');
SELECT public.publish_landing_page_with_note('lpg_NoteTest00001');
SELECT public.publish_landing_page('lpg_NoteTest00001');
INSERT INTO result SELECT 'notes', to_jsonb(array_agg(note ORDER BY note NULLS LAST)) FROM public.landing_page_versions WHERE page_id = 'lpg_NoteTest00001';
INSERT INTO result SELECT 'too_long_refused', to_jsonb(pg_temp.refused($$SELECT public.publish_landing_page_with_note('lpg_NoteTest00001', repeat('x', 201))$$));
INSERT INTO result SELECT 'direct_too_long_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_page_versions (page_id, title, data, note) VALUES ('lpg_NoteTest00001', 'x', '{}', repeat('x', 201))$$));
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'notes'), '["Fixed the Zznote", null, null, null]'::jsonb, 'a note is written on the version it publishes, trimmed; a blank or missing one is no note');
SELECT is((SELECT count(*) FROM public.landing_page_versions WHERE page_id = 'lpg_NoteTest00001'), 4::bigint, 'each publish made exactly one version');
SELECT is((SELECT value FROM result WHERE label = 'too_long_refused'), 'true'::jsonb, 'a note over 200 characters is refused by the function');
SELECT is((SELECT value FROM result WHERE label = 'direct_too_long_refused'), 'true'::jsonb, 'a note over 200 characters is refused by the table');
SELECT is((SELECT count(*) FROM public.landing_page_versions WHERE page_id = 'lpg_NoteTest00001'), 4::bigint, 'a refused publish left no version behind');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id = 'lpg_NoteTest00001' AND changes::text LIKE '%Zz%'), 0::bigint, 'neither the note nor the page content is in the audit log');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id = 'lpg_NoteTest00001'), 1::bigint, 'the page''s creation and publishes are one entry as the admin');

SELECT * FROM finish(true);
ROLLBACK;
