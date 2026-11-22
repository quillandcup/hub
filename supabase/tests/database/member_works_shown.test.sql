-- pgTAP tests for 20270918000000_milestones_start_at_the_globe.sql (docs/product/FINISHERS.md):
--   * a milestone confirmed for the first time starts at 'public' (the globe), unless the same write names another level, and a
--     confirmed one never moves when it is changed;
--   * the two work readers list each work once with its milestones in order, plus Published from the live Bookshelf books (at the
--     globe, never a stored level); a book with a project is that project's work; a deleted book shows nothing;
--   * a private milestone, its story, a proposal, a taken-back one and every id stay out, whoever asks;
--   * the web reader is service role only, the member reader a signed-in member or the service role, the shared body nobody.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(35);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f8a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mw-quinn@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f8a1', 'mw-quinn@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_mwPia0000001', 'Pia Works', 'mw-pia@example.test', now(), 'active', NULL),
  ('mbr_mwQuinn00001', 'Quinn Works', 'mw-quinn@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f8a1');
INSERT INTO public.writing_projects (id, member_id, title, phase) VALUES
  ('wprj_mwNovel0001', 'mbr_mwPia0000001', 'Pia Fake Project', 'revising');
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, project_id) VALUES
  ('book_mwNovel001', 'mbr_mwPia0000001', 'Pia Fake Novel', 'https://example.test/c.png', '2026-09-01', 'wprj_mwNovel0001'),
  ('book_mwLoose001', 'mbr_mwPia0000001', 'Pia Loose Fake Book', 'https://example.test/c.png', '2026-03-01', NULL);
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, deleted_at) VALUES
  ('book_mwGone0001', 'mbr_mwPia0000001', 'Pia Deleted Fake Book', 'https://example.test/c.png', '2026-02-01', now());

-- The default: a proposal is private, confirming it starts it at the globe, naming a level wins, and a confirmed one never moves.
INSERT INTO public.member_milestones (id, member_id, kind, source, title) VALUES
  ('mlst_mwProposed1', 'mbr_mwPia0000001', 'the_end', 'staff', 'A Proposed Fake Work'),
  ('mlst_mwProposed2', 'mbr_mwPia0000001', 'the_end', 'staff', 'A Chosen Fake Work');
SELECT is((SELECT visibility FROM public.member_milestones WHERE id = 'mlst_mwProposed1'), 'private', 'a proposal is private');
UPDATE public.member_milestones SET status = 'confirmed', confirmed_at = now() WHERE id = 'mlst_mwProposed1';
SELECT is((SELECT visibility FROM public.member_milestones WHERE id = 'mlst_mwProposed1'), 'public', 'confirming it starts it at the globe');
UPDATE public.member_milestones SET visibility = 'community' WHERE id = 'mlst_mwProposed1';
UPDATE public.member_milestones SET story_before = 'Changed my mind.' WHERE id = 'mlst_mwProposed1';
SELECT is((SELECT visibility FROM public.member_milestones WHERE id = 'mlst_mwProposed1'), 'community', 'changing a confirmed milestone keeps the level the member chose');
UPDATE public.member_milestones SET status = 'confirmed', confirmed_at = now(), visibility = 'community' WHERE id = 'mlst_mwProposed2';
SELECT is((SELECT visibility FROM public.member_milestones WHERE id = 'mlst_mwProposed2'), 'community', 'a level named in the confirming write is kept');
UPDATE public.member_milestones SET status = 'declined', confirmed_at = NULL, visibility = 'private' WHERE id = 'mlst_mwProposed2';
UPDATE public.member_milestones SET status = 'confirmed', confirmed_at = now() WHERE id = 'mlst_mwProposed2';
SELECT is((SELECT visibility FROM public.member_milestones WHERE id = 'mlst_mwProposed2'), 'public', 'a declined one the member brings back starts at the globe again');
SELECT is((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'member_milestones' AND column_name = 'visibility'), '''private''::text', 'and a row is still private until confirmed');
DELETE FROM public.member_milestones WHERE id IN ('mlst_mwProposed1', 'mlst_mwProposed2');

-- Fixtures: the project and its book are one work (THE END, publish-ready and Published); a title-only work has one milestone; a
-- private one, a proposal and a taken-back one are never shown; the loose book is Published only.
INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, project_id, title, achieved_on, story_after, visibility) VALUES
  ('mlst_mwReady001', 'mbr_mwPia0000001', 'publish_ready', 'member', 'confirmed', now(), 'wprj_mwNovel0001', NULL, NULL, NULL, 'public'),
  ('mlst_mwEnd00001', 'mbr_mwPia0000001', 'the_end', 'member', 'confirmed', now(), 'wprj_mwNovel0001', NULL, '2026-05-01', 'Novel story words.', 'community'),
  ('mlst_mwTitled01', 'mbr_mwPia0000001', 'the_end', 'member', 'confirmed', now(), NULL, 'A Titled Fake Work', NULL, 'Titled story words.', 'public'),
  ('mlst_mwPrivate1', 'mbr_mwPia0000001', 'the_end', 'member', 'confirmed', now(), NULL, 'A Private Fake Work', NULL, 'Private story words.', 'private'),
  ('mlst_mwDeleted1', 'mbr_mwPia0000001', 'the_end', 'member', 'confirmed', now(), NULL, 'A Deleted Fake Work', NULL, 'Deleted story words.', 'public');
UPDATE public.member_milestones SET deleted_at = now() WHERE id = 'mlst_mwDeleted1';
INSERT INTO public.member_milestones (id, member_id, kind, source, status, title) VALUES
  ('mlst_mwProposed3', 'mbr_mwPia0000001', 'publish_ready', 'staff', 'proposed', 'A Proposed Fake Work');

-- Another member through the member reader: community and public milestones, and Published; works numbered, steps in order.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f8a1", "email": "mw-quinn@example.test", "role": "authenticated"}', true);
SELECT results_eq(
  $$SELECT kind, work_title, visibility FROM public.member_works_shown_to_members('mbr_mwPia0000001') ORDER BY work_title, CASE kind WHEN 'the_end' THEN 1 WHEN 'publish_ready' THEN 2 ELSE 3 END$$,
  $$VALUES ('the_end'::text, 'A Titled Fake Work'::text, 'public'::text),
           ('the_end'::text, 'Pia Fake Novel'::text, 'community'::text), ('publish_ready'::text, 'Pia Fake Novel'::text, 'public'::text), ('published'::text, 'Pia Fake Novel'::text, 'public'::text),
           ('published'::text, 'Pia Loose Fake Book'::text, 'public'::text)$$,
  'another member sees each work with its community and public milestones and Published from the live books');
SELECT is((SELECT count(DISTINCT work_no)::int FROM public.member_works_shown_to_members('mbr_mwPia0000001')), 3, 'in three numbered works: the project with its book, the titled work, the loose book');
SELECT is((SELECT count(DISTINCT work_no)::int FROM public.member_works_shown_to_members('mbr_mwPia0000001') WHERE work_title = 'Pia Fake Novel'), 1, 'a project and its book are one work');
SELECT is(
  (SELECT string_agg(kind, ',') FROM public.member_works_shown_to_members('mbr_mwPia0000001') WHERE work_title = 'Pia Fake Novel'),
  'the_end,publish_ready,published', 'the steps of a work come out of the reader in the order of the journey');
SELECT is(
  (SELECT count(*)::int FROM public.member_works_shown_to_members('mbr_mwPia0000001') t WHERE row_to_json(t)::text ~ '(Private story|Deleted story|A Private Fake Work|A Deleted Fake Work|A Proposed Fake Work|Deleted Fake Book|mlst_|book_|wprj_)'),
  0, 'but never a private story or title, a taken-back or proposed one, a deleted book, or an id');
SELECT is((SELECT story_after FROM public.member_works_shown_to_members('mbr_mwPia0000001') WHERE kind = 'the_end' AND work_title = 'Pia Fake Novel'), 'Novel story words.', 'the story at that level comes with it');
SELECT is((SELECT bool_and(story_after IS NULL AND story_before IS NULL) FROM public.member_works_shown_to_members('mbr_mwPia0000001') WHERE kind = 'published'), true, 'Published has no story');
SELECT is((SELECT achieved_on::text FROM public.member_works_shown_to_members('mbr_mwPia0000001') WHERE kind = 'published' AND work_title = 'Pia Fake Novel'), '2026-09-01', 'and carries the book''s published date');
SELECT throws_ok($$SELECT * FROM public.member_works_shown_on_web('mbr_mwPia0000001')$$, '42501', NULL, 'a member cannot call the web reader');
SELECT throws_ok($$SELECT * FROM public.member_works_shown('mbr_mwPia0000001', ARRAY['public'])$$, '42501', NULL, 'nor the shared body');
RESET ROLE;

-- A visitor has no access.
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.member_works_shown_to_members('mbr_mwPia0000001')$$, '42501', NULL, 'a visitor cannot call the member reader');
SELECT throws_ok($$SELECT * FROM public.member_works_shown_on_web('mbr_mwPia0000001')$$, '42501', NULL, 'nor the web reader');
RESET ROLE;

-- The web reader (service role, after the page's own checks): only the globe, and Published.
SET LOCAL ROLE service_role;
SELECT results_eq(
  $$SELECT kind, work_title FROM public.member_works_shown_on_web('mbr_mwPia0000001') ORDER BY work_title, CASE kind WHEN 'the_end' THEN 1 WHEN 'publish_ready' THEN 2 ELSE 3 END$$,
  $$VALUES ('the_end'::text, 'A Titled Fake Work'::text), ('publish_ready'::text, 'Pia Fake Novel'::text), ('published'::text, 'Pia Fake Novel'::text), ('published'::text, 'Pia Loose Fake Book'::text)$$,
  'the web gets the milestones at the globe and Published, not the one at the house');
SELECT is((SELECT count(*)::int FROM public.member_works_shown_on_web('mbr_mwNobody0001')), 0, 'a member with nothing returns nothing');
RESET ROLE;

-- Taking the book away takes Published away, in both readers.
UPDATE public.member_books SET deleted_at = now() WHERE id IN ('book_mwNovel001', 'book_mwLoose001');
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.member_works_shown_on_web('mbr_mwPia0000001') WHERE kind = 'published'), 0, 'a deleted book is no longer Published');
SELECT is((SELECT count(*)::int FROM public.member_works_shown_to_members('mbr_mwPia0000001') WHERE kind = 'published'), 0, 'for members either');
RESET ROLE;

-- Naming a work that is only a project: by the project's title when the viewer may see the project, else no name at all.
-- Members see community and public projects, the web only public ones; the milestone itself is at the globe in every case.
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_mwRoy0000001', 'Roy Works', 'mw-roy@example.test', now(), 'active', NULL);
INSERT INTO public.writing_projects (id, member_id, title, phase, visibility) VALUES
  ('wprj_mwPriv00001', 'mbr_mwRoy0000001', 'Roy Private Fake Project', 'revising', 'private'),
  ('wprj_mwComm00001', 'mbr_mwRoy0000001', 'Roy Community Fake Project', 'revising', 'community'),
  ('wprj_mwOpen00001', 'mbr_mwRoy0000001', 'Roy Public Fake Project', 'revising', 'public'),
  ('wprj_mwGone00001', 'mbr_mwRoy0000001', 'Roy Deleted Fake Project', 'revising', 'public');
UPDATE public.writing_projects SET deleted_at = now() WHERE id = 'wprj_mwGone00001';
INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, project_id, visibility) VALUES
  ('mlst_mwRoyPriv01', 'mbr_mwRoy0000001', 'the_end', 'member', 'confirmed', now(), 'wprj_mwPriv00001', 'public'),
  ('mlst_mwRoyComm01', 'mbr_mwRoy0000001', 'the_end', 'member', 'confirmed', now(), 'wprj_mwComm00001', 'public'),
  ('mlst_mwRoyOpen01', 'mbr_mwRoy0000001', 'the_end', 'member', 'confirmed', now(), 'wprj_mwOpen00001', 'public'),
  ('mlst_mwRoyGone01', 'mbr_mwRoy0000001', 'the_end', 'member', 'confirmed', now(), 'wprj_mwGone00001', 'public');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f8a1", "email": "mw-quinn@example.test", "role": "authenticated"}', true);
SELECT results_eq(
  $$SELECT work_title FROM public.member_works_shown_to_members('mbr_mwRoy0000001') ORDER BY work_no$$,
  $$VALUES ('Roy Community Fake Project'::text), (NULL::text), ('Roy Public Fake Project'::text), (NULL::text)$$,
  'another member sees a project-only work named when its project is community or public, and unnamed when it is private or deleted');
SELECT is(
  (SELECT count(*)::int FROM public.member_works_shown_to_members('mbr_mwRoy0000001') t WHERE row_to_json(t)::text ~ '(Roy Private Fake Project|Roy Deleted Fake Project|wprj_)'),
  0, 'but never the title of a private or deleted project, or an id');
SELECT is((SELECT count(DISTINCT work_no)::int FROM public.member_works_shown_to_members('mbr_mwRoy0000001')), 4, 'each project is its own work, named or not');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT results_eq(
  $$SELECT work_title FROM public.member_works_shown_on_web('mbr_mwRoy0000001') ORDER BY work_no$$,
  $$VALUES (NULL::text), (NULL::text), ('Roy Public Fake Project'::text), (NULL::text)$$,
  'the web names a project-only work only when its project is public');
SELECT is(
  (SELECT count(*)::int FROM public.member_works_shown_on_web('mbr_mwRoy0000001') t WHERE row_to_json(t)::text ~ '(Roy Private Fake Project|Roy Community Fake Project|Roy Deleted Fake Project|wprj_)'),
  0, 'and never the title of a project that is not public, or an id');
RESET ROLE;

-- With the book deleted (above), the project's own name takes over for the work it had.
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT work_title FROM public.member_works_shown_to_members('mbr_mwPia0000001') WHERE kind = 'the_end' AND work_title LIKE 'Pia%Project'),
  'Pia Fake Project', 'a work whose book is gone is named by its project, which members may see');
RESET ROLE;

-- A project that goes private takes its name off the strip at once; the milestone stays.
UPDATE public.writing_projects SET visibility = 'private' WHERE id = 'wprj_mwComm00001';
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.member_works_shown_to_members('mbr_mwRoy0000001') WHERE work_title = 'Roy Community Fake Project'), 0, 'a project that goes private is no longer named');
SELECT is((SELECT count(*)::int FROM public.member_works_shown_to_members('mbr_mwRoy0000001') WHERE kind = 'the_end'), 4, 'but its milestone is still shown');
RESET ROLE;

SELECT is(
  (SELECT prosrc LIKE '%p.visibility = ANY (p_levels)%' FROM pg_proc WHERE proname = 'member_works_shown' AND pronamespace = 'public'::regnamespace),
  true, 'the shared body checks the project''s own level against the levels it serves');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'member_works_shown' AND pronamespace = 'public'::regnamespace AND prosecdef AND proconfig @> ARRAY['search_path=""']), 1, 'and still pins an empty search path');


-- All three are SECURITY DEFINER with a pinned search path; the member reader of badges stays and the old web reader is gone.
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('member_works_shown', 'member_works_shown_to_members', 'member_works_shown_on_web') AND prosecdef AND proconfig @> ARRAY['search_path=""']), 3, 'all three pin an empty search path');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'milestones_shown_to_members'), 1, 'the badge reader stays');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'milestones_shown_on_web'), 0, 'the old web reader, which nothing read, is dropped');

SELECT * FROM finish(true);
ROLLBACK;
