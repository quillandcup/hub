-- pgTAP tests for 20270890000000_member_milestones_per_work.sql (milestones belong to a work, docs/product/FINISHERS.md):
--   * a member can have the same kind for many works (a project, a book, a title), one live row per work;
--   * the title is short and never blank, and never reaches the Activity Log;
--   * a member's own insert may link their own live book, nobody else's;
--   * the per-book backfill: one proposal pair per book, a book that is its project's work counts once, an existing row of
--     that kind (any status, taken back included) keeps the work from being proposed again, idempotent, over 1200 members
--     with two books each, refused for anyone but an admin; the old per-member backfill still runs.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(32);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f6a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pw-pia@example.test'),
  ('00000000-0000-4000-a000-00000000f6a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pw-quinn@example.test'),
  ('00000000-0000-4000-a000-00000000f6a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pw-rae@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f6a1', 'pw-pia@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f6a2', 'pw-quinn@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f6a4', 'pw-rae@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_pwPia0000001', 'Pia Work', 'pw-pia@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f6a1'),
  ('mbr_pwQuinn00001', 'Quinn Work', 'pw-quinn@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f6a2'),
  ('mbr_pwRae0000001', 'Rae Work', 'pw-rae@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f6a4');
INSERT INTO public.writing_projects (id, member_id, title) VALUES
  ('prj_pwPia0000001', 'mbr_pwPia0000001', 'Pia Fake Novel'),
  ('prj_pwQuinn00001', 'mbr_pwQuinn00001', 'Quinn Fake Novel');
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, project_id) VALUES
  ('book_pwPia00001', 'mbr_pwPia0000001', 'Pia Book One', 'https://example.test/c.png', '2026-01-01', NULL),
  ('book_pwPia00002', 'mbr_pwPia0000001', 'Pia Book Two', 'https://example.test/c.png', '2026-02-01', NULL),
  ('book_pwQuinn001', 'mbr_pwQuinn00001', 'Quinn Book', 'https://example.test/c.png', '2026-01-01', 'prj_pwQuinn00001');
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, deleted_at) VALUES
  ('book_pwPiaGone1', 'mbr_pwPia0000001', 'Pia Deleted Book', 'https://example.test/c.png', '2026-03-01', now());

-- Many works per member, one row per work (as the owner, so no row-level security in the way).
SELECT lives_ok($$INSERT INTO public.member_milestones (member_id, kind, source, project_id) VALUES ('mbr_pwPia0000001', 'the_end', 'staff', 'prj_pwPia0000001')$$, 'a work can be a project');
SELECT lives_ok($$INSERT INTO public.member_milestones (member_id, kind, source, book_id) VALUES ('mbr_pwPia0000001', 'the_end', 'staff', 'book_pwPia00001')$$, 'the same kind for a second work, a book');
SELECT lives_ok($$INSERT INTO public.member_milestones (member_id, kind, source, title) VALUES ('mbr_pwPia0000001', 'the_end', 'staff', 'A Fake Memoir')$$, 'and a third, a title for a work that is not listed');
SELECT throws_ok($$INSERT INTO public.member_milestones (member_id, kind, source, project_id) VALUES ('mbr_pwPia0000001', 'the_end', 'course', 'prj_pwPia0000001')$$, '23505', NULL, 'one live row per member, kind and project');
SELECT throws_ok($$INSERT INTO public.member_milestones (member_id, kind, source, book_id) VALUES ('mbr_pwPia0000001', 'the_end', 'course', 'book_pwPia00001')$$, '23505', NULL, 'one per book');
SELECT throws_ok($$INSERT INTO public.member_milestones (member_id, kind, source, title) VALUES ('mbr_pwPia0000001', 'the_end', 'course', ' a fake MEMOIR ')$$, '23505', NULL, 'and one per title, whatever its case or outer spaces');
SELECT lives_ok($$INSERT INTO public.member_milestones (member_id, kind, source, title) VALUES ('mbr_pwPia0000001', 'publish_ready', 'staff', 'A Fake Memoir')$$, 'the other kind for the same work is its own row');
SELECT throws_ok($$INSERT INTO public.member_milestones (member_id, kind, source, title) VALUES ('mbr_pwQuinn00001', 'the_end', 'staff', repeat('x', 121))$$, '23514', NULL, 'a title is at most 120 characters');
SELECT throws_ok($$INSERT INTO public.member_milestones (member_id, kind, source, title) VALUES ('mbr_pwQuinn00001', 'the_end', 'staff', '   ')$$, '23514', NULL, 'and never blank');
SELECT lives_ok($$INSERT INTO public.member_milestones (member_id, kind, source) VALUES ('mbr_pwQuinn00001', 'publish_ready', 'staff')$$, 'a row that names no work (the old shape) is still valid');
SELECT throws_ok($$INSERT INTO public.member_milestones (member_id, kind, source) VALUES ('mbr_pwQuinn00001', 'publish_ready', 'staff')$$, '23505', NULL, 'and is still one per member and kind');
UPDATE public.member_milestones SET deleted_at = now() WHERE member_id = 'mbr_pwQuinn00001';
SELECT lives_ok($$INSERT INTO public.member_milestones (member_id, kind, source, title) VALUES ('mbr_pwPia0000001', 'publish_ready', 'staff', 'Another Fake Work')$$, 'a taken-back row frees only its own work (others are untouched)');

-- A member's own insert: own live book yes, someone else's or a deleted one no.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f6a1", "email": "pw-pia@example.test", "role": "authenticated"}', true);
SELECT lives_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, confirmed_at, book_id) VALUES ('mbr_pwPia0000001', 'the_end', 'member', 'confirmed', now(), 'book_pwPia00002')$$,
  'a member adds a milestone for one of their own books');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, confirmed_at, book_id) VALUES ('mbr_pwPia0000001', 'publish_ready', 'member', 'confirmed', now(), 'book_pwQuinn001')$$,
  '42501', NULL, 'but not for someone else''s book');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, confirmed_at, book_id) VALUES ('mbr_pwPia0000001', 'publish_ready', 'member', 'confirmed', now(), 'book_pwPiaGone1')$$,
  '42501', NULL, 'nor for one of their own books that was deleted');
SELECT lives_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, confirmed_at, title) VALUES ('mbr_pwPia0000001', 'publish_ready', 'member', 'confirmed', now(), 'Pia Secret Title Words')$$,
  'a member adds a milestone for a work they name by title');
SELECT throws_ok($$SELECT public.propose_milestones_for_books()$$, '42501', NULL, 'a member cannot run the per-book backfill');
RESET ROLE;

-- The title never reaches the Activity Log.
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'member_milestone' AND changes::text LIKE '%Pia Secret Title Words%'), 0, 'the title a member wrote is not in the Activity Log');
SELECT is((SELECT changes -> 'title' ->> 'new' FROM public.audit_log WHERE entity_type = 'member_milestone' AND action = 'insert' AND changes ? 'title' ORDER BY id DESC LIMIT 1), '[redacted]', 'it is logged as changed, never with its words');

-- Per-book backfill. Fixtures: Pia has two live books (and a deleted one), Quinn one book that is her project's work, and
-- 1200 more members have two books each (more than a page of 1000).
INSERT INTO public.members (id, name, email, joined_at, status)
SELECT 'mbr_pwBulk' || translate(lpad(i::text, 6, 'a'), '0', 'z'), 'Bulk Work ' || i, 'pw-bulk' || i || '@example.test', now(), 'active'
FROM generate_series(1, 1200) AS i;
INSERT INTO public.member_books (member_id, title, cover_url, published_date)
SELECT 'mbr_pwBulk' || translate(lpad(i::text, 6, 'a'), '0', 'z'), 'Bulk Book ' || i || '-' || b, 'https://example.test/c.png', '2026-01-01'
FROM generate_series(1, 1200) AS i, generate_series(1, 2) AS b;
-- Quinn already has THE END for her project (the book's work): only the other kind is proposed for her book.
INSERT INTO public.member_milestones (member_id, kind, source, status, confirmed_at, project_id) VALUES ('mbr_pwQuinn00001', 'the_end', 'member', 'confirmed', now(), 'prj_pwQuinn00001');
-- Pia answered no to publish-ready for book one: it stays a no.
INSERT INTO public.member_milestones (member_id, kind, source, status, book_id) VALUES ('mbr_pwPia0000001', 'publish_ready', 'staff', 'declined', 'book_pwPia00001');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, anon;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f6a4", "email": "pw-rae@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'first', to_jsonb(r) FROM public.propose_milestones_for_books() r;
INSERT INTO result SELECT 'second', to_jsonb(r) FROM public.propose_milestones_for_books() r;
RESET ROLE;

SELECT ok((SELECT (value ->> 'proposals')::int >= 4800 + 2 FROM result WHERE label = 'first'), 'the run adds a pair per book: 2400 bulk books, Pia''s book two and Quinn''s missing kind');
SELECT ok((SELECT (value ->> 'members')::int >= 1202 AND (value ->> 'books')::int >= 2402 FROM result WHERE label = 'first'), 'and reports the members and books it covered');
SELECT is((SELECT value FROM result WHERE label = 'second'), '{"books": 0, "members": 0, "proposals": 0}'::jsonb, 'a second run adds nothing');
SELECT is((SELECT count(*)::int FROM public.member_milestones WHERE member_id LIKE 'mbr_pwBulk%' AND source = 'staff' AND status = 'proposed'), 4800, 'every one of 1200 members gets both kinds for each of their two books');
SELECT is(
  (SELECT string_agg(m.kind || ':' || m.status || ':' || m.source, ',' ORDER BY m.kind) FROM public.member_milestones m WHERE m.member_id = 'mbr_pwQuinn00001' AND m.deleted_at IS NULL),
  'publish_ready:proposed:staff,the_end:confirmed:member', 'a book that is its project''s work counts once: the project''s THE END keeps the book from being proposed it again');
SELECT is(
  (SELECT project_id FROM public.member_milestones WHERE member_id = 'mbr_pwQuinn00001' AND kind = 'publish_ready' AND deleted_at IS NULL), 'prj_pwQuinn00001',
  'and the proposal carries the book''s project');
SELECT is(
  (SELECT string_agg(m.kind || ':' || m.status, ',' ORDER BY m.kind) FROM public.member_milestones m WHERE m.book_id = 'book_pwPia00001' AND m.deleted_at IS NULL),
  'publish_ready:declined,the_end:proposed', 'a no stays a no for that work, and the work''s other kind is proposed');
SELECT is((SELECT count(*)::int FROM public.member_milestones WHERE book_id = 'book_pwPiaGone1'), 0, 'a deleted book is not proposed');
SELECT is(
  (SELECT count(*)::int FROM public.member_milestones WHERE member_id = 'mbr_pwPia0000001' AND book_id = 'book_pwPia00002' AND kind = 'the_end' AND source = 'member'), 1,
  'Pia''s own milestone for book two stays hers: only publish-ready was proposed there');
SELECT is((SELECT count(*)::int FROM public.member_milestones WHERE member_id = 'mbr_pwPia0000001' AND book_id = 'book_pwPia00002'), 2, 'one row per kind for that book');

-- The old per-member backfill is still there until the contract step and still runs for admins.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f6a4", "email": "pw-rae@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT public.propose_milestones_from_books()$$, 'the old backfill function still runs for an admin');
RESET ROLE;

-- RLS is unchanged: a member reads only their own, nothing for a visitor.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f6a2", "email": "pw-quinn@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'quinn_sees', jsonb_agg(DISTINCT member_id) FROM public.member_milestones WHERE deleted_at IS NULL;
RESET ROLE;
SELECT is((SELECT value FROM result WHERE label = 'quinn_sees'), '["mbr_pwQuinn00001"]'::jsonb, 'a member still reads only their own milestones, the backfilled proposals of others included in the hiding');
SELECT ok(NOT has_table_privilege('anon', 'public.member_milestones', 'SELECT'), 'a visitor still has no access to the table');

SELECT * FROM finish(true);
ROLLBACK;
