-- pgTAP tests for 20271125000000_lesson_comments_import.sql and 20271125000100_lesson_comments_member_optional.sql
-- (comments imported from Kajabi):
--   * a comment is either written in the Hub (a member, no source) or imported (source, key and author name); the member is optional only for an import
--   * (source, source_key) is unique, comments written in the Hub (null key) never collide
--   * signed-in members read an imported comment like any other (live, lesson open, access), never edit or delete it, and never write the import columns
--   * staff moderate it like any other comment
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(17);

-- Alice has access, Carol has none, Dana is an admin.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000c11a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ci-alice@example.test'),
  ('00000000-0000-4000-a000-0000000c11a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ci-carol@example.test'),
  ('00000000-0000-4000-a000-0000000c11a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ci-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-0000000c11a1', 'ci-alice@example.test'),
  ('00000000-0000-4000-a000-0000000c11a3', 'ci-carol@example.test'),
  ('00000000-0000-4000-a000-0000000c11a4', 'ci-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-0000000c11a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAMiA1', 'Import Alice', 'ci-alice@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c11a1'),
  ('mbr_AAAAAAAAMiA3', 'Import Carol', 'ci-carol@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c11a3'),
  ('mbr_AAAAAAAAMiA4', 'Import Dana', 'ci-dana@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c11a4');

INSERT INTO public.courses (id, slug, title, source_key) VALUES
  ('crs_AAAAAAAAMiC1', 'pgtap-comment-import', 'PgTAP Comment Import', 'pgtap-comment-import');
INSERT INTO public.course_access (member_id, course_id, starts_at, ends_at, origin) VALUES
  ('mbr_AAAAAAAAMiA1', 'crs_AAAAAAAAMiC1', now() - interval '1 day', NULL, 'purchase');
INSERT INTO public.course_lessons (id, course_id, title, position, state, source_key) VALUES
  ('les_AAAAAAAAMiL1', 'crs_AAAAAAAAMiC1', 'Open lesson', 1, 'open', 'ci-open');

-- Imported comments, written as the database owner (the import uses the service role, which has no signed-in user).
INSERT INTO public.lesson_comments (id, lesson_id, member_id, parent_id, body, created_at, source, source_key, author_name) VALUES
  ('cmnt_AAAAAAAAMi01', 'les_AAAAAAAAMiL1', NULL, NULL, 'An old question', '2024-05-06 07:08:09+00', 'kajabi', 'ci-open/a', 'Pen Name');
INSERT INTO public.lesson_comments (id, lesson_id, member_id, parent_id, body, created_at, source, source_key, author_name) VALUES
  ('cmnt_AAAAAAAAMi02', 'les_AAAAAAAAMiL1', NULL, 'cmnt_AAAAAAAAMi01', 'An old answer', '2024-05-07 07:08:09+00', 'kajabi', 'ci-open/b', 'Another Pen Name');
INSERT INTO public.lesson_comments (id, lesson_id, member_id, body, hidden_at, source, source_key, author_name) VALUES
  ('cmnt_AAAAAAAAMi03', 'les_AAAAAAAAMiL1', NULL, 'A hidden one', now(), 'kajabi', 'ci-open/c', 'Hidden Pen Name');
INSERT INTO public.lesson_comments (id, lesson_id, member_id, body) VALUES
  ('cmnt_AAAAAAAAMi04', 'les_AAAAAAAAMiL1', 'mbr_AAAAAAAAMiA1', 'Written in the Hub'),
  ('cmnt_AAAAAAAAMi05', 'les_AAAAAAAAMiL1', 'mbr_AAAAAAAAMiA1', 'Another written in the Hub');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, anon;

-- Runs one statement as the current role and records how many rows it touched, or the error code.
CREATE FUNCTION pg_temp.try(p_label text, p_stmt text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  EXECUTE p_stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO result VALUES (p_label, to_jsonb(n));
EXCEPTION WHEN others THEN
  INSERT INTO result VALUES (p_label, to_jsonb(SQLSTATE));
END
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.try(text, text) TO authenticated, anon;

-- The shape rules, as the owner.
SELECT pg_temp.try('hub_comment_without_member', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body) VALUES ('les_AAAAAAAAMiL1', NULL, 'No one wrote this')$$);
SELECT pg_temp.try('imported_without_name', $$INSERT INTO public.lesson_comments (lesson_id, body, source, source_key) VALUES ('les_AAAAAAAAMiL1', 'No name', 'kajabi', 'ci-open/x')$$);
SELECT pg_temp.try('imported_without_key', $$INSERT INTO public.lesson_comments (lesson_id, body, source, author_name) VALUES ('les_AAAAAAAAMiL1', 'No key', 'kajabi', 'Pen Name')$$);
SELECT pg_temp.try('name_without_source', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body, author_name) VALUES ('les_AAAAAAAAMiL1', 'mbr_AAAAAAAAMiA1', 'A name alone', 'Pen Name')$$);
SELECT pg_temp.try('name_too_long', format($$INSERT INTO public.lesson_comments (lesson_id, body, source, source_key, author_name) VALUES ('les_AAAAAAAAMiL1', 'Long name', 'kajabi', 'ci-open/y', %L)$$, repeat('n', 201)));
SELECT pg_temp.try('duplicate_key', $$INSERT INTO public.lesson_comments (lesson_id, body, source, source_key, author_name) VALUES ('les_AAAAAAAAMiL1', 'Same again', 'kajabi', 'ci-open/a', 'Pen Name')$$);
SELECT pg_temp.try('upsert_same_key', $$INSERT INTO public.lesson_comments (lesson_id, body, source, source_key, author_name) VALUES ('les_AAAAAAAAMiL1', 'Edited by the import', 'kajabi', 'ci-open/a', 'Pen Name') ON CONFLICT (source, source_key) DO UPDATE SET body = EXCLUDED.body$$);

SET LOCAL ROLE authenticated;

-- Alice: current access.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c11a1", "email": "ci-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_sees_imported', to_jsonb(count(*)) FROM public.lesson_comments WHERE source = 'kajabi';
SELECT pg_temp.try('alice_edits_imported', $$UPDATE public.lesson_comments SET body = 'Mine now' WHERE id = 'cmnt_AAAAAAAAMi01'$$);
SELECT pg_temp.try('alice_deletes_imported', $$UPDATE public.lesson_comments SET deleted_at = now() WHERE id = 'cmnt_AAAAAAAAMi01'$$);
SELECT pg_temp.try('alice_posts_imported', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body, source, source_key, author_name) VALUES ('les_AAAAAAAAMiL1', 'mbr_AAAAAAAAMiA1', 'Pretending', 'kajabi', 'ci-open/z', 'Pen Name')$$);
SELECT pg_temp.try('alice_marks_own_imported', $$UPDATE public.lesson_comments SET source = 'kajabi', source_key = 'ci-open/mine', author_name = 'Pen Name' WHERE id = 'cmnt_AAAAAAAAMi04'$$);
SELECT pg_temp.try('alice_edits_own', $$UPDATE public.lesson_comments SET body = 'Edited in time' WHERE id = 'cmnt_AAAAAAAAMi05'$$);

-- Carol: no access.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c11a3", "email": "ci-carol@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'carol_sees_imported', to_jsonb(count(*)) FROM public.lesson_comments WHERE source = 'kajabi';

-- Dana: an admin reads everything, moderates it, and may write the columns.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c11a4", "email": "ci-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'dana_sees_imported', to_jsonb(count(*)) FROM public.lesson_comments WHERE source = 'kajabi';
INSERT INTO result VALUES ('dana_hides', to_jsonb(public.moderate_lesson_comment('cmnt_AAAAAAAAMi01', 'hide')));
INSERT INTO result VALUES ('dana_deletes', to_jsonb(public.moderate_lesson_comment('cmnt_AAAAAAAAMi02', 'delete')));
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'hub_comment_without_member'), '"23514"'::jsonb, 'a comment written in the Hub needs its member');
SELECT is((SELECT value FROM result WHERE label = 'imported_without_name'), '"23514"'::jsonb, 'an imported comment needs the name to show');
SELECT ok(
  (SELECT value = '"23514"'::jsonb FROM result WHERE label = 'imported_without_key')
  AND (SELECT value = '"23514"'::jsonb FROM result WHERE label = 'name_without_source')
  AND (SELECT value = '"23514"'::jsonb FROM result WHERE label = 'name_too_long'),
  'the import columns go together: a source needs its key, a name needs a source, and a name is at most 200 characters');
SELECT is((SELECT value FROM result WHERE label = 'duplicate_key'), '"23505"'::jsonb, 'the same source and key twice is refused');
SELECT is((SELECT body FROM public.lesson_comments WHERE source_key = 'ci-open/a'), 'Edited by the import', 'and an upsert on it updates the one row');
SELECT is((SELECT count(*)::int FROM public.lesson_comments WHERE source_key IS NULL AND lesson_id = 'les_AAAAAAAAMiL1'), 2, 'comments written in the Hub have no key and never collide');
SELECT is((SELECT member_id FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMi01'), NULL, 'an imported comment has no member');

SELECT is((SELECT value FROM result WHERE label = 'alice_sees_imported'), '2'::jsonb, 'a member with access reads the live imported comments (not the hidden one)');
SELECT is((SELECT value FROM result WHERE label = 'carol_sees_imported'), '0'::jsonb, 'a member with no access reads none');
SELECT is((SELECT value FROM result WHERE label = 'dana_sees_imported'), '3'::jsonb, 'an admin reads them all, hidden ones too');
SELECT ok(
  (SELECT value = '0'::jsonb FROM result WHERE label = 'alice_edits_imported')
  AND (SELECT value = '0'::jsonb FROM result WHERE label = 'alice_deletes_imported')
  AND (SELECT body = 'Edited by the import' AND deleted_at IS NULL FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMi01'),
  'a member can''t edit or delete an imported comment: it is nobody''s own');
SELECT is((SELECT value FROM result WHERE label = 'alice_posts_imported'), '"42501"'::jsonb, 'a member can''t post a comment that claims to be imported');
SELECT is((SELECT value FROM result WHERE label = 'alice_marks_own_imported'), '"42501"'::jsonb, 'nor mark her own comment as imported');
SELECT is((SELECT value FROM result WHERE label = 'alice_edits_own'), '1'::jsonb, 'but still edits her own comment within 15 minutes');
SELECT ok(
  (SELECT value = '"done"'::jsonb FROM result WHERE label = 'dana_hides')
  AND (SELECT value = '"done"'::jsonb FROM result WHERE label = 'dana_deletes')
  AND (SELECT hidden_at IS NOT NULL FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMi01')
  AND (SELECT deleted_at IS NOT NULL FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMi02'),
  'staff hide and delete an imported comment through the moderation function');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'lesson_comment' AND entity_id IN ('cmnt_AAAAAAAAMi01', 'cmnt_AAAAAAAAMi02')), 2, 'each is one audit entry');
SELECT is((SELECT created_at FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMi01'), '2024-05-06 07:08:09+00'::timestamptz, 'an imported comment keeps the time it was written at its source');

SELECT * FROM finish();
ROLLBACK;
