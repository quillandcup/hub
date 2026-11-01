-- pgTAP tests for 20270301000000_soft_delete_member_resources.sql:
--   * other members see only live books and awards; the owner (and admins) still see their own
--     deleted rows, which is also what lets the app's soft-delete UPDATE return the row;
--   * a member can soft delete their own book (the UPDATE ... RETURNING the app runs works) and
--     can't touch another member's;
--   * a deleted book no longer blocks publishing the same project again, a second live one does;
--   * get_profile_writing leaves deleted goals and progress entries out.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(11);

-- Alice owns the rows; Bob only views. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'softdel-alice@example.test'),
  ('00000000-0000-4000-a000-00000000d1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'softdel-bob@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', 'softdel-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000d1a2', 'softdel-bob@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAd1A1', 'Softdel Alice', 'softdel-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000d1a1'),
  ('mbr_AAAAAAAAd1A2', 'Softdel Bob', 'softdel-bob@example.test', now(), 'active', '00000000-0000-4000-a000-00000000d1a2');

INSERT INTO public.writing_projects (id, member_id, title, show_on_profile) VALUES
  ('prj_AAAAAAAAd111', 'mbr_AAAAAAAAd1A1', 'Shown project', true);

INSERT INTO public.member_books (id, member_id, title, cover_url, purchase_url, published_date, project_id, deleted_at) VALUES
  ('book_AAAAAAAAd111', 'mbr_AAAAAAAAd1A1', 'Live book', 'https://example.test/c.jpg', 'https://example.test/b', '2026-01-01', NULL, NULL),
  ('book_AAAAAAAAd112', 'mbr_AAAAAAAAd1A1', 'Deleted book', 'https://example.test/c.jpg', 'https://example.test/b', '2026-01-02', 'prj_AAAAAAAAd111', now());
INSERT INTO public.member_awards (id, member_id, award_name, work_title, award_date, deleted_at) VALUES
  ('00000000-0000-4000-a000-00000000d2a1', 'mbr_AAAAAAAAd1A1', 'Live award', 'Live book', '2026-01-01', NULL),
  ('00000000-0000-4000-a000-00000000d2a2', 'mbr_AAAAAAAAd1A1', 'Deleted award', 'Live book', '2026-01-02', now());

INSERT INTO public.writing_goals (id, member_id, project_id, goal_type, measure, target_amount, title, show_on_profile, deleted_at) VALUES
  ('00000000-0000-4000-a000-00000000d3a1', 'mbr_AAAAAAAAd1A1', 'prj_AAAAAAAAd111', 'target', 'words', 100, 'Live goal', true, NULL),
  ('00000000-0000-4000-a000-00000000d3a2', 'mbr_AAAAAAAAd1A1', 'prj_AAAAAAAAd111', 'target', 'pages', 10, 'Deleted goal', true, now());
INSERT INTO public.writing_progress_entries (id, member_id, project_id, entry_date, measure, mode, amount, deleted_at) VALUES
  ('00000000-0000-4000-a000-00000000d4a1', 'mbr_AAAAAAAAd1A1', 'prj_AAAAAAAAd111', '2026-01-02', 'words', 'delta', 1000, NULL),
  ('00000000-0000-4000-a000-00000000d4a2', 'mbr_AAAAAAAAd1A1', 'prj_AAAAAAAAd111', '2026-01-03', 'pages', 'delta', 7, now());

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- Bob, another member: sees the live rows only, and can't soft delete Alice's book.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d1a2", "email": "softdel-bob@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bob_books', to_jsonb(count(*)) FROM public.member_books WHERE member_id = 'mbr_AAAAAAAAd1A1';
INSERT INTO result SELECT 'bob_awards', to_jsonb(count(*)) FROM public.member_awards WHERE member_id = 'mbr_AAAAAAAAd1A1';
INSERT INTO result SELECT 'bob_profile', public.get_profile_writing('mbr_AAAAAAAAd1A1');
WITH u AS (UPDATE public.member_books SET deleted_at = now() WHERE id = 'book_AAAAAAAAd111' RETURNING id)
INSERT INTO result SELECT 'bob_soft_deletes_alices', to_jsonb(count(*)) FROM u;

-- Alice, the owner: still sees her deleted rows, and the soft-delete UPDATE ... RETURNING works.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d1a1", "email": "softdel-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_books', to_jsonb(count(*)) FROM public.member_books WHERE member_id = 'mbr_AAAAAAAAd1A1';
WITH u AS (UPDATE public.member_books SET deleted_at = now() WHERE id = 'book_AAAAAAAAd111' AND deleted_at IS NULL RETURNING id)
INSERT INTO result SELECT 'alice_soft_deletes', to_jsonb(count(*)) FROM u;
WITH u AS (UPDATE public.member_awards SET deleted_at = now() WHERE id = '00000000-0000-4000-a000-00000000d2a1' RETURNING id)
INSERT INTO result SELECT 'alice_soft_deletes_award', to_jsonb(count(*)) FROM u;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'bob_books'), '1'::jsonb, 'another member sees only the live book');
SELECT is((SELECT value FROM result WHERE label = 'bob_awards'), '1'::jsonb, 'another member sees only the live award');
SELECT is((SELECT value FROM result WHERE label = 'bob_soft_deletes_alices'), '0'::jsonb, 'another member can''t soft delete someone else''s book');
SELECT is((SELECT value FROM result WHERE label = 'alice_books'), '2'::jsonb, 'the owner still sees her deleted book (the app filters it out)');
SELECT is((SELECT value FROM result WHERE label = 'alice_soft_deletes'), '1'::jsonb, 'the owner can soft delete her book and get the row back');
SELECT is((SELECT value FROM result WHERE label = 'alice_soft_deletes_award'), '1'::jsonb, 'the owner can soft delete her award');

-- After her deletes only nothing live is left for Bob.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d1a2", "email": "softdel-bob@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bob_books_after', to_jsonb(count(*)) FROM public.member_books WHERE member_id = 'mbr_AAAAAAAAd1A1';
INSERT INTO result SELECT 'bob_awards_after', to_jsonb(count(*)) FROM public.member_awards WHERE member_id = 'mbr_AAAAAAAAd1A1';
RESET ROLE;
SELECT is((SELECT value FROM result WHERE label = 'bob_books_after'), '0'::jsonb, 'a book its owner deleted disappears for everyone else');
SELECT is((SELECT value FROM result WHERE label = 'bob_awards_after'), '0'::jsonb, 'an award its owner deleted disappears for everyone else');

-- One book per project: the deleted one on prj_...d111 doesn't block a new one, a second live one does.
SELECT lives_ok(
  $$INSERT INTO public.member_books (member_id, title, cover_url, purchase_url, published_date, project_id)
    VALUES ('mbr_AAAAAAAAd1A1', 'Republished', 'https://example.test/c.jpg', 'https://example.test/b', '2026-02-01', 'prj_AAAAAAAAd111')$$,
  'a deleted book does not block publishing the project again');
SELECT throws_ok(
  $$INSERT INTO public.member_books (member_id, title, cover_url, purchase_url, published_date, project_id)
    VALUES ('mbr_AAAAAAAAd1A1', 'Twice', 'https://example.test/c.jpg', 'https://example.test/b', '2026-02-02', 'prj_AAAAAAAAd111')$$,
  '23505', NULL, 'a second live book for the same project is still refused');

-- The profile's writing section leaves out the deleted goal and entry.
SELECT is(
  (SELECT jsonb_path_query_array(value, '$.goals[*].title') FROM result WHERE label = 'bob_profile')
  || (SELECT jsonb_path_query_array(value, '$.entries[*].measure') FROM result WHERE label = 'bob_profile'),
  '["Live goal", "words"]'::jsonb, 'a profile shows neither a deleted goal nor a deleted entry');

SELECT * FROM finish(true);
ROLLBACK;
