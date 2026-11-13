-- pgTAP tests for course address redirects (20270712000000): a Hub course that is published, or ever was, keeps its
-- old addresses working as redirects to the course; a never-published one changes address freely. The address space
-- is shared (a slug and a redirect can't be the same), first publication is stamped by a trigger, a rename back
-- removes the redirect, deleting the course removes them, and the audit log gets one entry per rename. Runs in one
-- transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(25);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'addr-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'addr-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', 'addr-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a4', 'addr-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- A draft that never was published, a published one, a second published one, and one imported from Kajabi.
INSERT INTO public.courses (id, slug, title, source, source_key, is_draft) VALUES
  ('crs_AddrDraft0001', 'pgtap-addr-draft', 'Draft', 'hub', NULL, true),
  ('crs_AddrLive00001', 'pgtap-addr-live', 'Live', 'hub', NULL, false),
  ('crs_AddrLive00002', 'pgtap-addr-other', 'Other', 'hub', NULL, false),
  ('crs_AddrKaj000001', 'pgtap-addr-kajabi', 'Imported', 'kajabi', 'pgtap-addr-kajabi', false);

-- The message a statement was refused with ('' when it wasn't), and the SQLSTATE.
CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated;
CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- First publication.
SELECT is((SELECT first_published_at FROM public.courses WHERE id = 'crs_AddrDraft0001'), NULL::timestamptz, 'a draft has no first_published_at');
SELECT ok((SELECT first_published_at IS NOT NULL FROM public.courses WHERE id = 'crs_AddrLive00001'), 'a course created published is stamped');

SET LOCAL ROLE authenticated;

-- Alice (a member) can't rename a course, and a rename she tried leaves no redirect.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "addr-alice@example.test", "role": "authenticated"}', true);
UPDATE public.courses SET slug = 'pgtap-addr-alice' WHERE id = 'crs_AddrLive00001';
RESET ROLE;
SELECT is((SELECT slug FROM public.courses WHERE id = 'crs_AddrLive00001'), 'pgtap-addr-live', 'a member''s rename changes nothing');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "addr-alice@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*) FROM public.course_address_redirects), 0::bigint, 'and no redirect appears');
SELECT is(pg_temp.failure($$INSERT INTO public.course_address_redirects (address, course_id) VALUES ('pgtap-addr-x', 'crs_AddrLive00001')$$) LIKE '42501:%', true, 'a member can''t write a redirect directly');

-- Dana (an admin).
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a4", "email": "addr-dana@example.test", "role": "authenticated"}', true);
SELECT is(pg_temp.failure($$INSERT INTO public.course_address_redirects (address, course_id) VALUES ('pgtap-addr-x', 'crs_AddrLive00001')$$) LIKE '42501:%', true, 'not even an admin writes a redirect directly (the trigger on courses does)');

-- A never-published draft: free to rename, no redirect.
UPDATE public.courses SET slug = 'pgtap-addr-draft-2' WHERE id = 'crs_AddrDraft0001';
SELECT is((SELECT count(*) FROM public.course_address_redirects WHERE course_id = 'crs_AddrDraft0001'), 0::bigint, 'renaming a never-published course leaves no redirect');

-- A published course: the old address redirects to it.
UPDATE public.courses SET slug = 'pgtap-addr-live-2' WHERE id = 'crs_AddrLive00001';
SELECT results_eq($$SELECT address FROM public.course_address_redirects WHERE course_id = 'crs_AddrLive00001'$$, $$VALUES ('pgtap-addr-live')$$, 'renaming a published course keeps its old address');
SELECT ok((SELECT id LIKE 'cslug\_%' FROM public.course_address_redirects WHERE address = 'pgtap-addr-live'), 'a redirect id has its prefix');

-- A second rename: the first address still resolves, to the course (no chain to follow).
UPDATE public.courses SET slug = 'pgtap-addr-live-3' WHERE id = 'crs_AddrLive00001';
SELECT results_eq($$SELECT address FROM public.course_address_redirects WHERE course_id = 'crs_AddrLive00001' ORDER BY address$$, $$VALUES ('pgtap-addr-live'), ('pgtap-addr-live-2')$$, 'every earlier address redirects');
SELECT is((SELECT c.slug FROM public.course_address_redirects r JOIN public.courses c ON c.id = r.course_id WHERE r.address = 'pgtap-addr-live'), 'pgtap-addr-live-3', 'and resolves to the newest address');

-- The address space is shared: nobody else takes an address a redirect holds, by rename or create.
SELECT is(pg_temp.failure($$UPDATE public.courses SET slug = 'pgtap-addr-live' WHERE id = 'crs_AddrLive00002'$$) LIKE '23505:%', true, 'another course can''t rename onto an old address');
SELECT is(pg_temp.failure($$INSERT INTO public.courses (slug, title, source) VALUES ('pgtap-addr-live-2', 'Squatter', 'hub')$$) LIKE '23505:%', true, 'nor create one with it');
-- ...and a redirect can't hold another course's live address (the guard on the table, as the owner would write it).
RESET ROLE;
SELECT is(pg_temp.failure($$INSERT INTO public.course_address_redirects (address, course_id) VALUES ('pgtap-addr-other', 'crs_AddrLive00001')$$) LIKE '23505:%', true, 'a redirect can''t hold another course''s address');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a4", "email": "addr-dana@example.test", "role": "authenticated"}', true);

-- Back to an address it used before: canonical again, so its redirect goes; the others stay.
UPDATE public.courses SET slug = 'pgtap-addr-live' WHERE id = 'crs_AddrLive00001';
SELECT is((SELECT count(*) FROM public.course_address_redirects WHERE address = 'pgtap-addr-live'), 0::bigint, 'renaming back removes that redirect');
SELECT results_eq($$SELECT address FROM public.course_address_redirects WHERE course_id = 'crs_AddrLive00001' ORDER BY address$$, $$VALUES ('pgtap-addr-live-2'), ('pgtap-addr-live-3')$$, 'and the course keeps the others');

-- Unpublishing keeps first_published_at: the course counts as once-published, so a rename still redirects.
UPDATE public.courses SET is_draft = true WHERE id = 'crs_AddrLive00002';
SELECT ok((SELECT first_published_at IS NOT NULL FROM public.courses WHERE id = 'crs_AddrLive00002'), 'unpublishing keeps first_published_at');
UPDATE public.courses SET slug = 'pgtap-addr-other-2' WHERE id = 'crs_AddrLive00002';
SELECT results_eq($$SELECT address FROM public.course_address_redirects WHERE course_id = 'crs_AddrLive00002'$$, $$VALUES ('pgtap-addr-other')$$, 'an unpublished once-published course still redirects its old address');

-- Publishing the draft stamps the first time; a rename afterwards redirects.
UPDATE public.courses SET is_draft = false WHERE id = 'crs_AddrDraft0001';
SELECT ok((SELECT first_published_at IS NOT NULL FROM public.courses WHERE id = 'crs_AddrDraft0001'), 'publishing stamps first_published_at');
UPDATE public.courses SET slug = 'pgtap-addr-draft-3' WHERE id = 'crs_AddrDraft0001';
SELECT results_eq($$SELECT address FROM public.course_address_redirects WHERE course_id = 'crs_AddrDraft0001'$$, $$VALUES ('pgtap-addr-draft-2')$$, 'a published course keeps the address it had when published');

-- An imported course's address is Kajabi's: no redirect, and it is not editable by an admin's client either.
RESET ROLE;
UPDATE public.courses SET slug = 'pgtap-addr-kajabi-2' WHERE id = 'crs_AddrKaj000001';
SELECT is((SELECT count(*) FROM public.course_address_redirects WHERE course_id = 'crs_AddrKaj000001'), 0::bigint, 'no redirect for an imported course');

-- The audit log: one entry for the rename (the course's own update, slug old/new), none for the redirect row.
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_type = 'course' AND entity_id = 'crs_AddrLive00002' AND changes -> 'slug' ->> 'new' = 'pgtap-addr-other-2'), 1::bigint, 'the rename is one audit entry');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_type = 'course_address_redirect'), 0::bigint, 'and the redirect rows write none');
SELECT is((SELECT changes -> 'slug' ->> 'old' FROM public.audit_log WHERE entity_type = 'course' AND entity_id = 'crs_AddrLive00002' AND changes -> 'slug' ->> 'new' = 'pgtap-addr-other-2'), 'pgtap-addr-other', 'which names the address it left');

-- Deleting a course removes its redirects.
DELETE FROM public.courses WHERE id = 'crs_AddrLive00001';
SELECT is((SELECT count(*) FROM public.course_address_redirects WHERE course_id = 'crs_AddrLive00001'), 0::bigint, 'deleting a course removes its redirects');

SELECT * FROM finish(true);
ROLLBACK;
