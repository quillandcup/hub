-- pgTAP tests for the page builder's tables (20270805000000): only admins read or write landing pages and their versions
-- (a member and a signed-out visitor get nothing), the address is unique among live pages and frees up when a page is
-- deleted, publishing keeps a version in one step, restoring puts a version into the draft without publishing it, and the
-- audit log records the intent (publish, restore, rename) as the admin but not the autosave of the draft. Runs in one
-- transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(34);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e5a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pages-member@example.test'),
  ('00000000-0000-4000-a000-00000000e5a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pages-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e5a1', 'pages-member@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e5a2', 'pages-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Made as the database owner, so what the admin does to it below is a separate audit story from its creation.
INSERT INTO public.landing_pages (id, slug, title, draft_data) VALUES
  ('lpg_PagesTest0001', 'pgtap-pages-one', 'Page One', '{"content": [{"type": "Heading", "props": {"text": "First"}}], "root": {}}'),
  ('lpg_PagesTest0002', 'pgtap-pages-two', 'Page Two', '{"content": [], "root": {}}');

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
INSERT INTO result SELECT 'anon_read_refused', to_jsonb(pg_temp.refused($$SELECT count(*) FROM public.landing_pages$$));
INSERT INTO result SELECT 'anon_versions_refused', to_jsonb(pg_temp.refused($$SELECT count(*) FROM public.landing_page_versions$$));
RESET ROLE;

-- A member.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e5a1", "email": "pages-member@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_sees', to_jsonb(count(*)) FROM public.landing_pages;
INSERT INTO result SELECT 'member_insert_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_pages (slug, title) VALUES ('pgtap-pages-member', 'Mine')$$));
UPDATE public.landing_pages SET title = 'Hacked' WHERE id = 'lpg_PagesTest0001';
INSERT INTO result SELECT 'member_publish_message', to_jsonb(pg_temp.failure($$SELECT public.publish_landing_page('lpg_PagesTest0001')$$));
RESET ROLE;
INSERT INTO result SELECT 'title_after_member', to_jsonb(title) FROM public.landing_pages WHERE id = 'lpg_PagesTest0001';

-- An admin.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e5a2", "email": "pages-admin@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.landing_pages WHERE slug LIKE 'pgtap-pages-%';
INSERT INTO public.landing_pages (slug, title, created_by) VALUES ('pgtap-pages-new', 'New', '00000000-0000-4000-a000-00000000e5a2');
INSERT INTO result SELECT 'admin_id_short', to_jsonb(id LIKE 'lpg\_%') FROM public.landing_pages WHERE slug = 'pgtap-pages-new';
INSERT INTO result SELECT 'defaults', to_jsonb(status || ':' || draft_data::text) FROM public.landing_pages WHERE slug = 'pgtap-pages-new';
INSERT INTO result SELECT 'duplicate_slug_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_pages (slug, title) VALUES ('pgtap-pages-new', 'Again')$$));
INSERT INTO result SELECT 'bad_slug_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_pages (slug, title) VALUES ('Not Valid', 'Bad')$$));
INSERT INTO result SELECT 'blank_title_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_pages (slug, title) VALUES ('pgtap-pages-blank', '  ')$$));
INSERT INTO result SELECT 'bad_status_refused', to_jsonb(pg_temp.refused($$UPDATE public.landing_pages SET status = 'live' WHERE id = 'lpg_PagesTest0002'$$));
-- A deleted page frees its address.
UPDATE public.landing_pages SET deleted_at = now() WHERE slug = 'pgtap-pages-new';
INSERT INTO public.landing_pages (slug, title) VALUES ('pgtap-pages-new', 'Reused');
INSERT INTO result SELECT 'slug_reused', to_jsonb(count(*)) FROM public.landing_pages WHERE slug = 'pgtap-pages-new' AND deleted_at IS NULL;

-- Autosave: the draft changes, nothing is audited.
UPDATE public.landing_pages SET draft_data = '{"content": [{"type": "Heading", "props": {"text": "Second"}}], "root": {}}', updated_at = now(), updated_by = '00000000-0000-4000-a000-00000000e5a2' WHERE id = 'lpg_PagesTest0001';
UPDATE public.landing_pages SET draft_data = '{"content": [{"type": "Heading", "props": {"text": "Third"}}], "root": {}}', updated_at = now() WHERE id = 'lpg_PagesTest0001';
INSERT INTO result SELECT 'autosave_audit_rows', to_jsonb(count(*)) FROM public.audit_log WHERE entity_type = 'landing_page' AND entity_id = 'lpg_PagesTest0001' AND action = 'update';

-- Publish: the draft goes live and a version is kept, in one step; one audit entry for the intent, without the document.
SELECT public.publish_landing_page('lpg_PagesTest0001');
INSERT INTO result SELECT 'published', to_jsonb(status || ':' || (published_data = draft_data)::text || ':' || (first_published_at IS NOT NULL)::text) FROM public.landing_pages WHERE id = 'lpg_PagesTest0001';
INSERT INTO result SELECT 'versions_after_publish', to_jsonb(count(*)) FROM public.landing_page_versions WHERE page_id = 'lpg_PagesTest0001';
INSERT INTO result SELECT 'version_id_short', to_jsonb(bool_and(id LIKE 'lpgv\_%')) FROM public.landing_page_versions WHERE page_id = 'lpg_PagesTest0001';
INSERT INTO result
  SELECT 'publish_audit', to_jsonb(jsonb_build_object('who', changed_by, 'kind', actor_kind, 'status', changes #>> '{status,new}', 'document_logged', (changes ? 'draft_data') OR (changes #> '{published_data,new}') IS DISTINCT FROM '"[redacted]"'::jsonb))
    FROM public.audit_log WHERE entity_type = 'landing_page' AND entity_id = 'lpg_PagesTest0001' AND action = 'update';
INSERT INTO result SELECT 'publish_missing_message', to_jsonb(pg_temp.failure($$SELECT public.publish_landing_page('lpg_PagesTestNone')$$));

-- A later draft is not published until published again.
UPDATE public.landing_pages SET draft_data = '{"content": [], "root": {}}' WHERE id = 'lpg_PagesTest0001';
INSERT INTO result SELECT 'published_unchanged_by_draft', to_jsonb(published_data #>> '{content,0,props,text}') FROM public.landing_pages WHERE id = 'lpg_PagesTest0001';

-- Restore: the version's document becomes the draft; the published page stays as it was.
SELECT public.restore_landing_page_version((SELECT id FROM public.landing_page_versions WHERE page_id = 'lpg_PagesTest0001'));
INSERT INTO result SELECT 'restored_draft', to_jsonb(draft_data #>> '{content,0,props,text}') FROM public.landing_pages WHERE id = 'lpg_PagesTest0001';
INSERT INTO result SELECT 'restored_marked', to_jsonb(restored_from_version_id IS NOT NULL AND restored_at IS NOT NULL) FROM public.landing_pages WHERE id = 'lpg_PagesTest0001';
INSERT INTO result SELECT 'restored_still_published', to_jsonb(status || ':' || (published_data #>> '{content,0,props,text}')) FROM public.landing_pages WHERE id = 'lpg_PagesTest0001';
INSERT INTO result SELECT 'restore_missing_message', to_jsonb(pg_temp.failure($$SELECT public.restore_landing_page_version('lpgv_PagesTestNone')$$));

-- Unpublish and rename are audited as the admin.
UPDATE public.landing_pages SET status = 'draft', title = 'Page One, renamed' WHERE id = 'lpg_PagesTest0001';

-- Import from Kajabi: a page made by an import has a key, one live page per key; a repeat import (a new draft and a new
-- imported_at) is one audit entry that carries no content; the draft kept before it is a version that restores like any.
INSERT INTO public.landing_pages (id, slug, title, import_key, imported_at, created_by) VALUES ('lpg_PagesTest0004', 'pgtap-pages-imported', 'Imported page', 'kajabi:key:1', now(), '00000000-0000-4000-a000-00000000e5a2');
INSERT INTO result SELECT 'import_key_twin_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_pages (slug, title, import_key) VALUES ('pgtap-pages-imported-twin', 'Twin', 'kajabi:key:1')$$));
INSERT INTO public.landing_page_versions (page_id, title, data, kind) VALUES ('lpg_PagesTest0004', 'Imported page', '{"content": [{"type": "Heading", "props": {"text": "Kept before"}}], "root": {}}', 'before_import');
INSERT INTO result SELECT 'bad_version_kind_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_page_versions (page_id, title, data, kind) VALUES ('lpg_PagesTest0004', 'x', '{}', 'other')$$));
UPDATE public.landing_pages SET draft_data = '{"content": [{"type": "Heading", "props": {"text": "Zzcontent"}}], "root": {}}', imported_at = now(), updated_at = now() WHERE id = 'lpg_PagesTest0002';
INSERT INTO result SELECT 'import_audit', to_jsonb((SELECT count(*) FROM public.audit_log WHERE entity_type = 'landing_page' AND entity_id = 'lpg_PagesTest0002' AND action = 'update' AND changes ? 'imported_at' AND changes::text NOT LIKE '%Zzcontent%'));
INSERT INTO result SELECT 'kept_version_kind', to_jsonb(kind) FROM public.landing_page_versions WHERE page_id = 'lpg_PagesTest0004';
SELECT public.restore_landing_page_version((SELECT id FROM public.landing_page_versions WHERE page_id = 'lpg_PagesTest0004'));
INSERT INTO result SELECT 'before_import_restored', to_jsonb(draft_data #>> '{content,0,props,text}') FROM public.landing_pages WHERE id = 'lpg_PagesTest0004';

-- Replacing a draft: the draft kept before it is a before_replace version, and the replacement (a new draft and a
-- new replaced_at) is one audit entry that carries no content.
INSERT INTO public.landing_page_versions (page_id, title, data, kind) VALUES ('lpg_PagesTest0002', 'Page Two', '{"content": [{"type": "Heading", "props": {"text": "Kept before replace"}}], "root": {}}', 'before_replace');
INSERT INTO result SELECT 'replace_version_kind', to_jsonb(kind) FROM public.landing_page_versions WHERE page_id = 'lpg_PagesTest0002';
UPDATE public.landing_pages SET draft_data = '{"content": [{"type": "Heading", "props": {"text": "Zzreplace"}}], "root": {}}', replaced_at = now(), updated_at = now() WHERE id = 'lpg_PagesTest0002';
INSERT INTO result SELECT 'replace_audit', to_jsonb((SELECT count(*) FROM public.audit_log WHERE entity_type = 'landing_page' AND entity_id = 'lpg_PagesTest0002' AND action = 'update' AND changes ? 'replaced_at' AND changes::text NOT LIKE '%Zzreplace%'));
RESET ROLE;

-- The server's read of a published page (the service role), and what an update by the service role records.
INSERT INTO public.landing_pages (id, slug, title, status, draft_data, published_data) VALUES
  ('lpg_PagesTest0003', 'pgtap-pages-live', 'Live', 'published', '{"content": [], "root": {}}', '{"content": [], "root": {}}');
SET LOCAL ROLE service_role;
INSERT INTO result SELECT 'service_reads_published', to_jsonb(count(*)) FROM public.landing_pages WHERE status = 'published' AND slug = 'pgtap-pages-live' AND deleted_at IS NULL;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'anon_read_refused'), 'true'::jsonb, 'a signed-out visitor can''t read landing pages');
SELECT is((SELECT value FROM result WHERE label = 'anon_versions_refused'), 'true'::jsonb, 'a signed-out visitor can''t read versions');
SELECT is((SELECT value FROM result WHERE label = 'member_sees'), '0'::jsonb, 'a member sees no landing pages');
SELECT is((SELECT value FROM result WHERE label = 'member_insert_refused'), 'true'::jsonb, 'a member can''t add a page');
SELECT is((SELECT value FROM result WHERE label = 'title_after_member'), '"Page One"'::jsonb, 'a member can''t change a page');
SELECT is((SELECT value FROM result WHERE label = 'member_publish_message'), '"not_found"'::jsonb, 'a member can''t publish (the page is not theirs to see)');
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '2'::jsonb, 'an admin sees the pages');
SELECT is((SELECT value FROM result WHERE label = 'admin_id_short'), 'true'::jsonb, 'a page gets a short lpg_ id');
SELECT is((SELECT value FROM result WHERE label = 'defaults'), '"draft:{\"root\": {}, \"content\": []}"'::jsonb, 'a new page is a draft with an empty document');
SELECT is((SELECT value FROM result WHERE label = 'duplicate_slug_refused'), 'true'::jsonb, 'two live pages can''t share an address');
SELECT is((SELECT value FROM result WHERE label = 'bad_slug_refused'), 'true'::jsonb, 'an address must be lowercase words and dashes');
SELECT is((SELECT value FROM result WHERE label = 'blank_title_refused'), 'true'::jsonb, 'a page needs a title');
SELECT is((SELECT value FROM result WHERE label = 'bad_status_refused'), 'true'::jsonb, 'a page is a draft or published');
SELECT is((SELECT value FROM result WHERE label = 'slug_reused'), '1'::jsonb, 'a deleted page frees its address');
SELECT is((SELECT value FROM result WHERE label = 'autosave_audit_rows'), '0'::jsonb, 'autosaving the draft writes no audit entry');
SELECT is((SELECT value FROM result WHERE label = 'published'), '"published:true:true"'::jsonb, 'publishing copies the draft to the published page');
SELECT is((SELECT value FROM result WHERE label = 'versions_after_publish'), '1'::jsonb, 'publishing keeps one version');
SELECT is((SELECT value FROM result WHERE label = 'version_id_short'), 'true'::jsonb, 'a version gets a short lpgv_ id');
SELECT is((SELECT value FROM result WHERE label = 'publish_missing_message'), '"not_found"'::jsonb, 'publishing a page that doesn''t exist is refused');
SELECT is((SELECT value FROM result WHERE label = 'restore_missing_message'), '"not_found"'::jsonb, 'restoring a version that doesn''t exist is refused');
SELECT is((SELECT value FROM result WHERE label = 'publish_audit'), jsonb_build_object('who', '00000000-0000-4000-a000-00000000e5a2'::text, 'kind', 'staff', 'status', 'published', 'document_logged', false), 'publishing is one audit entry as the admin, without the document''s content');
SELECT is((SELECT value FROM result WHERE label = 'published_unchanged_by_draft'), '"Third"'::jsonb, 'editing the draft leaves the published page alone');
SELECT is((SELECT value FROM result WHERE label = 'restored_draft'), '"Third"'::jsonb, 'restoring puts the version''s document in the draft');
SELECT is((SELECT value FROM result WHERE label = 'restored_still_published'), '"published:Third"'::jsonb, 'restoring does not publish');
SELECT is(
  (SELECT (changes ? 'restored_at')::text || ':' || (changes ? 'title')::text FROM public.audit_log WHERE entity_type = 'landing_page' AND entity_id = 'lpg_PagesTest0001' AND action = 'update'),
  'true:true', 'a restore and a rename are audited as the admin''s intent');
SELECT is((SELECT value FROM result WHERE label = 'import_key_twin_refused'), 'true'::jsonb, 'two live pages can''t come from the same import');
SELECT is((SELECT value FROM result WHERE label = 'bad_version_kind_refused'), 'true'::jsonb, 'a version is a published one or one kept before an import');
SELECT is((SELECT value FROM result WHERE label = 'import_audit'), '1'::jsonb, 'an import is one audit entry, without the page''s content');
SELECT is((SELECT value FROM result WHERE label = 'kept_version_kind'), '"before_import"'::jsonb, 'the draft kept before an import is a before_import version');
SELECT is((SELECT value FROM result WHERE label = 'before_import_restored'), '"Kept before"'::jsonb, 'a draft kept before an import can be brought back');
SELECT is((SELECT value FROM result WHERE label = 'replace_version_kind'), '"before_replace"'::jsonb, 'the draft kept before a template or import replaces it is a before_replace version');
SELECT is((SELECT value FROM result WHERE label = 'replace_audit'), '1'::jsonb, 'replacing the draft is one audit entry, without the page''s content');
SELECT lives_ok($$INSERT INTO public.landing_page_versions (page_id, title, data, kind) VALUES ('lpg_PagesTest0002', 'Old name', '{"content": [], "root": {}}', 'before_starter')$$, 'the old kind name is still accepted until it is removed (code live during the deploy still writes it)');
SELECT is((SELECT value FROM result WHERE label = 'service_reads_published'), '1'::jsonb, 'the server reads a published page with the service role');

SELECT * FROM finish(true);
ROLLBACK;
