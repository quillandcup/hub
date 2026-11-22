-- pgTAP tests for 20270912000000_member_milestones_visibility.sql (who sees a milestone, docs/product/FINISHERS.md):
--   * a milestone is private until confirmed (CHECK), and confirming one starts it at 'public' (the globe) without moving a confirmed one;
--   * the member sets the level of their own row, nobody else's, and the change is an audit row that never holds the story;
--   * another member and an admin, through the member-facing reader, never get a private milestone or its story, a proposal,
--     a taken-back one, or an id; the table itself is still unreadable to another member;
--   * the web reader returns only 'public' rows and only to the service role (not to a member, an admin or a visitor).
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(33);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mv-pia@example.test'),
  ('00000000-0000-4000-a000-00000000f7a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mv-quinn@example.test'),
  ('00000000-0000-4000-a000-00000000f7a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mv-rae@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', 'mv-pia@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f7a2', 'mv-quinn@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f7a4', 'mv-rae@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_mvPia0000001', 'Pia Visible', 'mv-pia@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f7a1'),
  ('mbr_mvQuinn00001', 'Quinn Visible', 'mv-quinn@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f7a2'),
  ('mbr_mvRae0000001', 'Rae Visible', 'mv-rae@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f7a4');
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date) VALUES
  ('book_mvPia00001', 'mbr_mvPia0000001', 'Pia Fake Book', 'https://example.test/c.png', '2026-01-01');
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, deleted_at) VALUES
  ('book_mvPiaGone1', 'mbr_mvPia0000001', 'Pia Deleted Fake Book', 'https://example.test/c.png', '2026-02-01', now());

-- The level only exists on a confirmed row.
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, title, visibility) VALUES ('mbr_mvPia0000001', 'the_end', 'staff', 'Proposed Fake Work', 'community')$$,
  '23514', NULL, 'a proposal cannot be shown to anyone: only a confirmed milestone is more than private');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, confirmed_at, title, visibility) VALUES ('mbr_mvPia0000001', 'the_end', 'member', 'confirmed', now(), 'Odd Fake Work', 'everyone')$$,
  '23514', NULL, 'and the level is one of private, community or public');

-- Fixtures (as the owner of the table): four confirmed, one proposed, one deleted.
INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, book_id, title, achieved_on, story_after, visibility) VALUES
  ('mlst_mvCommunity', 'mbr_mvPia0000001', 'the_end', 'member', 'confirmed', now(), 'book_mvPia00001', NULL, '2026-05-01', 'Community story words.', 'community'),
  ('mlst_mvPublic001', 'mbr_mvPia0000001', 'publish_ready', 'member', 'confirmed', now(), NULL, 'A Public Fake Work', NULL, 'Public story words.', 'public'),
  ('mlst_mvPrivate01', 'mbr_mvPia0000001', 'the_end', 'member', 'confirmed', now(), NULL, 'A Private Fake Work', NULL, 'Private story words.', 'private'),
  ('mlst_mvDeleted01', 'mbr_mvPia0000001', 'the_end', 'member', 'confirmed', now(), NULL, 'A Deleted Fake Work', NULL, 'Deleted story words.', 'community');
UPDATE public.member_milestones SET deleted_at = now() WHERE id = 'mlst_mvDeleted01';
INSERT INTO public.member_milestones (id, member_id, kind, source, status, title) VALUES
  ('mlst_mvProposed1', 'mbr_mvPia0000001', 'publish_ready', 'staff', 'proposed', 'A Proposed Fake Work');
-- Quinn has one community milestone too (no work named).
INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, book_id, visibility) VALUES
  ('mlst_mvGoneBook1', 'mbr_mvQuinn00001', 'the_end', 'member', 'confirmed', now(), NULL, 'community');

-- Confirming a proposal starts it at the globe (the default), and changing a confirmed one never moves it.
SELECT is((SELECT visibility FROM public.member_milestones WHERE id = 'mlst_mvProposed1'), 'private', 'a proposal is private');
UPDATE public.member_milestones SET status = 'confirmed', confirmed_at = now() WHERE id = 'mlst_mvProposed1';
SELECT is((SELECT visibility FROM public.member_milestones WHERE id = 'mlst_mvProposed1'), 'public', 'confirming it starts it at the globe');
UPDATE public.member_milestones SET visibility = 'private' WHERE id = 'mlst_mvProposed1';
UPDATE public.member_milestones SET story_before = 'Changed my mind.' WHERE id = 'mlst_mvProposed1';
SELECT is((SELECT visibility FROM public.member_milestones WHERE id = 'mlst_mvProposed1'), 'private', 'changing a confirmed milestone keeps the level the member chose');
UPDATE public.member_milestones SET status = 'declined', confirmed_at = NULL, visibility = 'private' WHERE id = 'mlst_mvProposed1';
UPDATE public.member_milestones SET status = 'confirmed', confirmed_at = now() WHERE id = 'mlst_mvProposed1';
SELECT is((SELECT visibility FROM public.member_milestones WHERE id = 'mlst_mvProposed1'), 'public', 'a declined one the member brings back starts at the globe again');
UPDATE public.member_milestones SET deleted_at = now() WHERE id = 'mlst_mvProposed1';

-- The member sets the level of their own milestone; another member cannot; both are checked as the signed-in user.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "mv-pia@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$UPDATE public.member_milestones SET visibility = 'private' WHERE id = 'mlst_mvCommunity'$$, 'a member sets the level of their own milestone');
SELECT is((SELECT visibility FROM public.member_milestones WHERE id = 'mlst_mvCommunity'), 'private', 'and it stuck');
SELECT lives_ok($$UPDATE public.member_milestones SET visibility = 'community' WHERE id = 'mlst_mvCommunity'$$, 'and sets it back');
SELECT results_eq($$SELECT count(*)::int FROM public.member_milestones WHERE member_id = 'mbr_mvPia0000001' AND deleted_at IS NULL$$, $$VALUES (3)$$, 'they read their own milestones, private included');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a2", "email": "mv-quinn@example.test", "role": "authenticated"}', true);
UPDATE public.member_milestones SET visibility = 'public' WHERE id = 'mlst_mvPrivate01';
SELECT is((SELECT count(*)::int FROM public.member_milestones WHERE id = 'mlst_mvPrivate01'), 0, 'another member cannot read the table directly');
RESET ROLE;
SELECT is((SELECT visibility FROM public.member_milestones WHERE id = 'mlst_mvPrivate01'), 'private', 'and cannot change someone else''s level');

-- Another member through the member-facing reader: community and public only, with the stories at those levels, no id.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a2", "email": "mv-quinn@example.test", "role": "authenticated"}', true);
SELECT results_eq(
  $$SELECT kind, work_title, visibility FROM public.milestones_shown_to_members('mbr_mvPia0000001')$$,
  $$VALUES ('the_end'::text, 'Pia Fake Book'::text, 'community'::text), ('publish_ready'::text, 'A Public Fake Work'::text, 'public'::text)$$,
  'another member sees the community and public milestones, with the book''s name or the title the member wrote');
SELECT is((SELECT story_after FROM public.milestones_shown_to_members('mbr_mvPia0000001') WHERE kind = 'the_end'), 'Community story words.', 'and the story at that level');
SELECT is(
  (SELECT count(*)::int FROM public.milestones_shown_to_members('mbr_mvPia0000001') t WHERE row_to_json(t)::text ~ '(Private story|Deleted story|A Private Fake Work|A Deleted Fake Work|A Proposed Fake Work|mlst_)'),
  0, 'but never a private story or title, a taken-back or proposed one, or an id');
SELECT is((SELECT count(*)::int FROM public.milestones_shown_to_members('mbr_mvQuinn00001')), 1, 'a member sees their own community milestone through it too');
SELECT throws_ok($$SELECT * FROM public.member_works_shown_on_web('mbr_mvPia0000001')$$, '42501', NULL, 'another member cannot call the web reader');
RESET ROLE;

-- An admin through the same reader sees exactly what another member sees: a private milestone stays private from staff here.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a4", "email": "mv-rae@example.test", "role": "authenticated"}', true);
SELECT results_eq(
  $$SELECT kind, visibility FROM public.milestones_shown_to_members('mbr_mvPia0000001')$$,
  $$VALUES ('the_end'::text, 'community'::text), ('publish_ready'::text, 'public'::text)$$,
  'an admin through the member-facing reader gets no private milestone');
SELECT is(
  (SELECT count(*)::int FROM public.milestones_shown_to_members('mbr_mvPia0000001') t WHERE row_to_json(t)::text LIKE '%Private story%'),
  0, 'nor its story');
SELECT throws_ok($$SELECT * FROM public.member_works_shown_on_web('mbr_mvPia0000001')$$, '42501', NULL, 'and an admin cannot call the web reader either');
RESET ROLE;

-- A visitor has no access to either reader.
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.milestones_shown_to_members('mbr_mvPia0000001')$$, '42501', NULL, 'a visitor cannot call the member reader');
SELECT throws_ok($$SELECT * FROM public.member_works_shown_on_web('mbr_mvPia0000001')$$, '42501', NULL, 'nor the web reader');
RESET ROLE;

-- The web reader (service role, which the page uses after checking the profile is on): only the globe.
SET LOCAL ROLE service_role;
SELECT results_eq(
  $$SELECT kind, work_title, story_after, visibility FROM public.member_works_shown_on_web('mbr_mvPia0000001') WHERE kind <> 'published'$$,
  $$VALUES ('publish_ready'::text, 'A Public Fake Work'::text, 'Public story words.'::text, 'public'::text)$$,
  'the web gets only the milestone at the globe, with its story');
SELECT is((SELECT count(*)::int FROM public.member_works_shown_on_web('mbr_mvQuinn00001') WHERE kind <> 'published'), 0, 'a community milestone is not on the web');
SELECT is((SELECT count(*)::int FROM public.member_works_shown_on_web('mbr_mvNobody0001')), 0, 'and a member with nothing returns nothing');
RESET ROLE;

-- A deleted book lends no name, and a deleted milestone leaves the web too.
UPDATE public.member_milestones SET book_id = 'book_mvPiaGone1' WHERE id = 'mlst_mvPrivate01';
UPDATE public.member_milestones SET visibility = 'public', title = NULL WHERE id = 'mlst_mvPrivate01';
SELECT is((SELECT work_title FROM public.member_works_shown_on_web('mbr_mvPia0000001') WHERE story_after = 'Private story words.'), NULL, 'a deleted book does not lend its title');
UPDATE public.member_milestones SET deleted_at = now() WHERE id = 'mlst_mvPublic001';
SELECT is((SELECT count(*)::int FROM public.member_works_shown_on_web('mbr_mvPia0000001') WHERE kind = 'publish_ready'), 0, 'a taken-back milestone leaves the web');

-- The Activity Log: the change of level is an audit row as the member, and never the story.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "mv-pia@example.test", "role": "authenticated"}', true);
UPDATE public.member_milestones SET visibility = 'private' WHERE id = 'mlst_mvCommunity';
RESET ROLE;
SELECT is(
  (SELECT changes -> 'visibility' ->> 'new' FROM public.audit_log WHERE entity_type = 'member_milestone' AND entity_id = 'mlst_mvCommunity' AND changes ? 'visibility' ORDER BY id DESC LIMIT 1),
  'private', 'a change of level is one audit entry with the old and new level');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'member_milestone' AND changes::text LIKE '%story words%'),
  0, 'and no story text is ever in the Activity Log');

-- The member reader is SECURITY DEFINER with a pinned search path; the old web reader is gone (the web reads member_works_shown_on_web); the old consent columns are still there for the contract step.
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'milestones_shown_to_members' AND prosecdef AND proconfig @> ARRAY['search_path=""']), 1, 'the member reader pins an empty search path');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'milestones_shown_on_web'), 0, 'and the old web reader is gone');
SELECT is((SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'member_milestones' AND column_name IN ('consent_profile', 'consent_homepage', 'consent_testimonial')), 3, 'the old consent columns stay until the contract step');
SELECT is((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'member_milestones' AND column_name = 'consent_testimonial'), 'false', 'and the one consent is off by default');

SELECT * FROM finish(true);
ROLLBACK;
