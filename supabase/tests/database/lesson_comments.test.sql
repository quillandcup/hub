-- pgTAP tests for 20270801000000_lesson_comments.sql (lesson comments, phase 1):
--   * reads need current access to the lesson's course and an open lesson; ended access and a coming-soon lesson see nothing
--   * admins read everything, including deleted comments
--   * writes: as yourself only, never as staff, never in sudo; the text for 15 minutes; soft delete of your own
--   * one level of replies, on the same lesson
--   * grants: nothing for anon, no hard delete for signed-in users
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(29);

-- Alice has access, Bob had access that ended, Carol has none, Dana is an admin.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000c01a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lc-alice@example.test'),
  ('00000000-0000-4000-a000-0000000c01a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lc-bob@example.test'),
  ('00000000-0000-4000-a000-0000000c01a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lc-carol@example.test'),
  ('00000000-0000-4000-a000-0000000c01a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lc-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-0000000c01a1', 'lc-alice@example.test'),
  ('00000000-0000-4000-a000-0000000c01a2', 'lc-bob@example.test'),
  ('00000000-0000-4000-a000-0000000c01a3', 'lc-carol@example.test'),
  ('00000000-0000-4000-a000-0000000c01a4', 'lc-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-0000000c01a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAMcA1', 'Comment Alice', 'lc-alice@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c01a1'),
  ('mbr_AAAAAAAAMcA2', 'Comment Bob', 'lc-bob@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c01a2'),
  ('mbr_AAAAAAAAMcA3', 'Comment Carol', 'lc-carol@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c01a3'),
  ('mbr_AAAAAAAAMcA4', 'Comment Dana', 'lc-dana@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c01a4');

INSERT INTO public.courses (id, slug, title, source_key) VALUES
  ('crs_AAAAAAAAMcC1', 'pgtap-comments', 'PgTAP Comments', 'pgtap-comments');
INSERT INTO public.course_access (member_id, course_id, starts_at, ends_at, origin) VALUES
  ('mbr_AAAAAAAAMcA1', 'crs_AAAAAAAAMcC1', now() - interval '1 day', NULL, 'purchase'),
  ('mbr_AAAAAAAAMcA2', 'crs_AAAAAAAAMcC1', now() - interval '10 days', now() - interval '1 day', 'purchase');
INSERT INTO public.course_lessons (id, course_id, title, position, state, source_key) VALUES
  ('les_AAAAAAAAMcL1', 'crs_AAAAAAAAMcC1', 'Open lesson', 1, 'open', 'lc-open'),
  ('les_AAAAAAAAMcL2', 'crs_AAAAAAAAMcC1', 'Other open lesson', 2, 'open', 'lc-open-2'),
  ('les_AAAAAAAAMcL3', 'crs_AAAAAAAAMcC1', 'Soon lesson', 3, 'coming_soon', 'lc-soon');

-- Comments made as the database owner (the server's service role does the same): Bob's, from when he had access;
-- one 20 minutes old of Alice's; and one on the coming-soon lesson.
INSERT INTO public.lesson_comments (id, lesson_id, member_id, parent_id, body, created_at) VALUES
  ('cmnt_AAAAAAAAMc01', 'les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA2', NULL, 'Bob asked this', now() - interval '2 days'),
  ('cmnt_AAAAAAAAMc02', 'les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA1', NULL, 'An old one of Alice', now() - interval '20 minutes'),
  ('cmnt_AAAAAAAAMc03', 'les_AAAAAAAAMcL3', 'mbr_AAAAAAAAMcA2', NULL, 'On a lesson not open yet', now() - interval '3 days');
INSERT INTO public.lesson_comments (id, lesson_id, member_id, parent_id, body, deleted_at, deleted_by) VALUES
  ('cmnt_AAAAAAAAMc04', 'les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA2', NULL, 'Bob deleted this', now(), 'mbr_AAAAAAAAMcA2');

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

SET LOCAL ROLE authenticated;

-- Alice: current access.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c01a1", "email": "lc-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_sees', to_jsonb(count(*)) FROM public.lesson_comments;
INSERT INTO result SELECT 'alice_sees_deleted', to_jsonb(count(*)) FROM public.lesson_comments WHERE deleted_at IS NOT NULL;
INSERT INTO result SELECT 'alice_sees_coming_soon', to_jsonb(count(*)) FROM public.lesson_comments WHERE lesson_id = 'les_AAAAAAAAMcL3';
SELECT pg_temp.try('alice_posts', $$INSERT INTO public.lesson_comments (id, lesson_id, member_id, body) VALUES ('cmnt_AAAAAAAAMc10', 'les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA1', 'Hello')$$);
SELECT pg_temp.try('alice_posts_as_bob', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body) VALUES ('les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA2', 'As Bob')$$);
SELECT pg_temp.try('alice_posts_staff_badge', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body, is_staff_reply) VALUES ('les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA1', 'Badge', true)$$);
SELECT pg_temp.try('alice_posts_on_coming_soon', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body) VALUES ('les_AAAAAAAAMcL3', 'mbr_AAAAAAAAMcA1', 'Too early')$$);
SELECT pg_temp.try('alice_posts_empty', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body) VALUES ('les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA1', '')$$);
SELECT pg_temp.try('alice_posts_too_long', format($$INSERT INTO public.lesson_comments (lesson_id, member_id, body) VALUES ('les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA1', %L)$$, repeat('x', 4001)));
SELECT pg_temp.try('alice_replies', $$INSERT INTO public.lesson_comments (id, lesson_id, member_id, parent_id, body) VALUES ('cmnt_AAAAAAAAMc11', 'les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA1', 'cmnt_AAAAAAAAMc01', 'A reply')$$);
SELECT pg_temp.try('alice_replies_to_reply', $$INSERT INTO public.lesson_comments (lesson_id, member_id, parent_id, body) VALUES ('les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA1', 'cmnt_AAAAAAAAMc11', 'Nested')$$);
SELECT pg_temp.try('alice_replies_across_lessons', $$INSERT INTO public.lesson_comments (lesson_id, member_id, parent_id, body) VALUES ('les_AAAAAAAAMcL2', 'mbr_AAAAAAAAMcA1', 'cmnt_AAAAAAAAMc01', 'Wrong lesson')$$);
SELECT pg_temp.try('alice_edits_new', $$UPDATE public.lesson_comments SET body = 'Hello again' WHERE id = 'cmnt_AAAAAAAAMc10'$$);
SELECT pg_temp.try('alice_edits_old', $$UPDATE public.lesson_comments SET body = 'Too late' WHERE id = 'cmnt_AAAAAAAAMc02'$$);
SELECT pg_temp.try('alice_edits_bobs', $$UPDATE public.lesson_comments SET body = 'Not mine' WHERE id = 'cmnt_AAAAAAAAMc01'$$);
SELECT pg_temp.try('alice_moves_comment', $$UPDATE public.lesson_comments SET lesson_id = 'les_AAAAAAAAMcL2' WHERE id = 'cmnt_AAAAAAAAMc10'$$);
SELECT pg_temp.try('alice_hides_own', $$UPDATE public.lesson_comments SET hidden_at = now() WHERE id = 'cmnt_AAAAAAAAMc10'$$);
SELECT pg_temp.try('alice_deletes_old', $$UPDATE public.lesson_comments SET deleted_at = now() WHERE id = 'cmnt_AAAAAAAAMc02'$$);
SELECT pg_temp.try('alice_hard_deletes', $$DELETE FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMc10'$$);

-- Bob: access ended yesterday. Carol: none.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c01a2", "email": "lc-bob@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bob_sees_other_lesson_comments', to_jsonb(count(*)) FROM public.lesson_comments WHERE member_id <> 'mbr_AAAAAAAAMcA2';
SELECT pg_temp.try('bob_posts', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body) VALUES ('les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA2', 'Still here?')$$);
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c01a3", "email": "lc-carol@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'carol_sees', to_jsonb(count(*)) FROM public.lesson_comments;
SELECT pg_temp.try('carol_posts', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body) VALUES ('les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA3', 'Let me in')$$);

-- Alice again: she deletes her own new comment (the edit above stamped it).
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c01a1", "email": "lc-alice@example.test", "role": "authenticated"}', true);
SELECT pg_temp.try('alice_deletes_new', $$UPDATE public.lesson_comments SET deleted_at = now() WHERE id = 'cmnt_AAAAAAAAMc10'$$);
SELECT pg_temp.try('alice_undeletes', $$UPDATE public.lesson_comments SET deleted_at = NULL WHERE id = 'cmnt_AAAAAAAAMc10'$$);

-- Dana: an admin reads everything and posts with the instructor badge.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c01a4", "email": "lc-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'dana_sees', to_jsonb(count(*)) FROM public.lesson_comments;
SELECT pg_temp.try('dana_answers', $$INSERT INTO public.lesson_comments (lesson_id, member_id, parent_id, body, is_staff_reply) VALUES ('les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA4', 'cmnt_AAAAAAAAMc01', 'An answer', true)$$);
SELECT pg_temp.try('dana_posts_as_alice', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body) VALUES ('les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA1', 'Not hers to write')$$);

-- Sudo: Dana previewing as Alice. The header names the member; nothing may be written.
SELECT set_config('request.headers', '{"x-acting-as": "00000000-0000-4000-a000-0000000c01a4:mbr_AAAAAAAAMcA1"}', true);
SELECT pg_temp.try('sudo_posts', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body) VALUES ('les_AAAAAAAAMcL1', 'mbr_AAAAAAAAMcA4', 'Posting while previewing')$$);
INSERT INTO result SELECT 'sudo_reads', to_jsonb(count(*)) FROM public.lesson_comments;
SELECT set_config('request.headers', '{}', true);

-- Signed out.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);
SELECT pg_temp.try('anon_reads', 'SELECT * FROM public.lesson_comments');
RESET ROLE;

-- Reads.
SELECT is((SELECT value FROM result WHERE label = 'alice_sees'), '2'::jsonb, 'a member with access reads the live comments of open lessons (her own and Bob''s), not the deleted or the coming-soon ones');
SELECT is((SELECT value FROM result WHERE label = 'alice_sees_deleted'), '0'::jsonb, 'a member never reads another member''s deleted comment');
SELECT is((SELECT value FROM result WHERE label = 'alice_sees_coming_soon'), '0'::jsonb, 'comments on a lesson that is not open yet stay hidden');
SELECT is((SELECT value FROM result WHERE label = 'bob_sees_other_lesson_comments'), '0'::jsonb, 'a member whose access ended reads no one else''s comments');
SELECT is((SELECT value FROM result WHERE label = 'carol_sees'), '0'::jsonb, 'a member with no access reads nothing');
SELECT is((SELECT value FROM result WHERE label = 'dana_sees'), '6'::jsonb, 'an admin reads every comment, deleted and unreleased ones too');

-- Posting.
SELECT is((SELECT value FROM result WHERE label = 'alice_posts'), '1'::jsonb, 'a member with access posts as herself');
SELECT is((SELECT value FROM result WHERE label = 'alice_posts_as_bob'), '"42501"'::jsonb, 'but not as another member');
SELECT is((SELECT value FROM result WHERE label = 'alice_posts_staff_badge'), '"42501"'::jsonb, 'and never with the instructor badge');
SELECT is((SELECT value FROM result WHERE label = 'alice_posts_on_coming_soon'), '"42501"'::jsonb, 'nor on a lesson that is not open');
SELECT is((SELECT value FROM result WHERE label = 'alice_posts_empty'), '"23514"'::jsonb, 'an empty comment is refused');
SELECT is((SELECT value FROM result WHERE label = 'alice_posts_too_long'), '"23514"'::jsonb, 'and one over 4,000 characters');
SELECT is((SELECT value FROM result WHERE label = 'bob_posts'), '"42501"'::jsonb, 'ended access can''t post');
SELECT is((SELECT value FROM result WHERE label = 'carol_posts'), '"42501"'::jsonb, 'no access can''t post');
SELECT is((SELECT value FROM result WHERE label = 'dana_answers'), '1'::jsonb, 'an admin answers with the instructor badge');
SELECT is((SELECT value FROM result WHERE label = 'dana_posts_as_alice'), '"42501"'::jsonb, 'but not as someone else');
SELECT is((SELECT value FROM result WHERE label = 'sudo_posts'), '"42501"'::jsonb, 'sudo is read-only: an admin previewing as a member can''t post');
SELECT is((SELECT value FROM result WHERE label = 'sudo_reads'), '7'::jsonb, 'but can read');
SELECT is((SELECT value FROM result WHERE label = 'anon_reads'), '"42501"'::jsonb, 'signed-out visitors have no access to the table');

-- Threads.
SELECT is((SELECT value FROM result WHERE label = 'alice_replies'), '1'::jsonb, 'a reply goes under a top-level comment');
SELECT is((SELECT value FROM result WHERE label = 'alice_replies_to_reply'), '"23514"'::jsonb, 'but not under another reply');
SELECT is((SELECT value FROM result WHERE label = 'alice_replies_across_lessons'), '"23514"'::jsonb, 'nor on another lesson than its parent');

-- Editing and deleting.
SELECT ok(
  (SELECT (value = '1'::jsonb) FROM result WHERE label = 'alice_edits_new')
  AND (SELECT edited_at IS NOT NULL AND body = 'Hello again' FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMc10'),
  'an author edits the text within 15 minutes, and the edit is stamped');
SELECT is((SELECT value FROM result WHERE label = 'alice_edits_old'), '"42501"'::jsonb, 'but not after the window');
SELECT is((SELECT value FROM result WHERE label = 'alice_edits_bobs'), '0'::jsonb, 'and never someone else''s comment');
SELECT is((SELECT value FROM result WHERE label = 'alice_moves_comment'), '"42501"'::jsonb, 'nothing but the text can change: not the lesson');
SELECT is((SELECT value FROM result WHERE label = 'alice_hides_own'), '"42501"'::jsonb, 'nor hiding, which is staff''s');
SELECT ok(
  (SELECT value = '1'::jsonb FROM result WHERE label = 'alice_deletes_old')
  AND (SELECT value = '1'::jsonb FROM result WHERE label = 'alice_deletes_new')
  AND (SELECT deleted_by = 'mbr_AAAAAAAAMcA1' FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMc10')
  AND (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'alice_undeletes'),
  'an author soft deletes her own comment at any age, it records who, and she can''t bring it back');
SELECT ok(
  (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'alice_hard_deletes')
  AND NOT has_table_privilege('authenticated', 'public.lesson_comments', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.lesson_comments', 'SELECT')
  AND has_table_privilege('service_role', 'public.lesson_comments', 'DELETE'),
  'grants: no hard delete for signed-in users, nothing for anon, everything for the service role');

SELECT * FROM finish(true);
ROLLBACK;
