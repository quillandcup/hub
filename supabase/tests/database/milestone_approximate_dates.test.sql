-- pgTAP tests for 20271020000000_milestone_approximate_dates.sql (docs/product/FINISHERS.md):
--   * achieved_precision is 'day' by default, and a month or a year must hold the first day of its period (a CHECK);
--   * the member can change it with the rest of their answer (column grant), and nobody else can;
--   * the dated readers return the precision with each date (Published is always a day), only what the viewer may see, no ids;
--   * the web reader is service role only, the member reader a signed-in member or the service role, the shared body nobody.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(18);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f9a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ap-vera@example.test'),
  ('00000000-0000-4000-a000-00000000f9a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ap-wade@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000f9a1', 'ap-vera@example.test'),
  ('00000000-0000-4000-a000-00000000f9a2', 'ap-wade@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_apVera000001', 'Vera Dates', 'ap-vera@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f9a1'),
  ('mbr_apWade000001', 'Wade Dates', 'ap-wade@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f9a2');
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date) VALUES
  ('book_apVera00001', 'mbr_apVera000001', 'Vera Fake Book', 'https://example.test/c.png', '2026-03-09');

-- The column and its rule.
INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, title, achieved_on, achieved_precision, visibility) VALUES
  ('mlst_apDay000001', 'mbr_apVera000001', 'the_end', 'member', 'confirmed', now(), 'A Day Fake Work', '2026-05-17', 'day', 'public'),
  ('mlst_apMonth0001', 'mbr_apVera000001', 'the_end', 'member', 'confirmed', now(), 'A Month Fake Work', '2026-05-01', 'month', 'public'),
  ('mlst_apYear00001', 'mbr_apVera000001', 'the_end', 'member', 'confirmed', now(), 'A Year Fake Work', '2024-01-01', 'year', 'community'),
  ('mlst_apNone00001', 'mbr_apVera000001', 'the_end', 'member', 'confirmed', now(), 'A Dateless Fake Work', NULL, 'month', 'public'),
  ('mlst_apPrivate01', 'mbr_apVera000001', 'the_end', 'member', 'confirmed', now(), 'A Private Fake Work', '2025-02-01', 'month', 'private');
SELECT is((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'member_milestones' AND column_name = 'achieved_precision'), '''day''::text', 'the precision is the day unless said otherwise');
SELECT is((SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'member_milestones' AND column_name = 'achieved_precision'), 'NO', 'and is never empty');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, title, achieved_on, achieved_precision) VALUES ('mlst_apBadMonth1', 'mbr_apVera000001', 'publish_ready', 'member', 'confirmed', now(), 'Bad', '2026-05-17', 'month')$$,
  '23514', NULL, 'a month must hold the first day of the month');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, title, achieved_on, achieved_precision) VALUES ('mlst_apBadYear01', 'mbr_apVera000001', 'publish_ready', 'member', 'confirmed', now(), 'Bad', '2026-05-01', 'year')$$,
  '23514', NULL, 'a year must hold the first of January');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, title, achieved_on, achieved_precision) VALUES ('mlst_apBadWord01', 'mbr_apVera000001', 'publish_ready', 'member', 'confirmed', now(), 'Bad', '2026-05-01', 'week')$$,
  '23514', NULL, 'only day, month and year are precisions');

-- The member changes it with the answer; another member cannot.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f9a1", "email": "ap-vera@example.test", "role": "authenticated"}', true);
UPDATE public.member_milestones SET achieved_on = '2026-05-20', achieved_precision = 'day' WHERE id = 'mlst_apMonth0001';
SELECT is((SELECT achieved_precision FROM public.member_milestones WHERE id = 'mlst_apMonth0001'), 'day', 'the member can change the precision with the date');
UPDATE public.member_milestones SET achieved_on = '2026-05-01', achieved_precision = 'month' WHERE id = 'mlst_apMonth0001';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f9a2", "email": "ap-wade@example.test", "role": "authenticated"}', true);
UPDATE public.member_milestones SET achieved_precision = 'year', achieved_on = '2026-01-01' WHERE id = 'mlst_apMonth0001';
RESET ROLE;
SELECT is((SELECT achieved_precision FROM public.member_milestones WHERE id = 'mlst_apMonth0001'), 'month', 'another member cannot');

-- Another member through the member reader: community and public, with the precision of each date, and Published as a day.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f9a2", "email": "ap-wade@example.test", "role": "authenticated"}', true);
SELECT results_eq(
  $$SELECT work_title, kind, achieved_on::text, achieved_precision FROM public.member_works_dated_to_members('mbr_apVera000001') ORDER BY work_title$$,
  $$VALUES ('A Dateless Fake Work'::text, 'the_end'::text, NULL::text, 'month'::text),
           ('A Day Fake Work'::text, 'the_end'::text, '2026-05-17'::text, 'day'::text),
           ('A Month Fake Work'::text, 'the_end'::text, '2026-05-01'::text, 'month'::text),
           ('A Year Fake Work'::text, 'the_end'::text, '2024-01-01'::text, 'year'::text),
           ('Vera Fake Book'::text, 'published'::text, '2026-03-09'::text, 'day'::text)$$,
  'a member sees the dates as exactly as they were given, and Published as a day') ;
SELECT is(
  (SELECT count(*)::int FROM public.member_works_dated_to_members('mbr_apVera000001') t WHERE row_to_json(t)::text ~ '(A Private Fake Work|mlst_|book_)'),
  0, 'but never a private milestone, or an id');
SELECT throws_ok($$SELECT * FROM public.member_works_dated_on_web('mbr_apVera000001')$$, '42501', NULL, 'a member cannot call the web reader');
SELECT throws_ok($$SELECT * FROM public.member_works_dated('mbr_apVera000001', ARRAY['public'])$$, '42501', NULL, 'nor the shared body');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.member_works_dated_to_members('mbr_apVera000001')$$, '42501', NULL, 'a visitor cannot call the member reader');
SELECT throws_ok($$SELECT * FROM public.member_works_dated_on_web('mbr_apVera000001')$$, '42501', NULL, 'nor the web reader');
RESET ROLE;

-- The web reader: the globe only, with the precision.
SET LOCAL ROLE service_role;
SELECT results_eq(
  $$SELECT work_title, achieved_precision FROM public.member_works_dated_on_web('mbr_apVera000001') ORDER BY work_title$$,
  $$VALUES ('A Dateless Fake Work'::text, 'month'::text), ('A Day Fake Work'::text, 'day'::text), ('A Month Fake Work'::text, 'month'::text), ('Vera Fake Book'::text, 'day'::text)$$,
  'the web gets the milestones at the globe, not the one at the house');
SELECT is((SELECT count(*)::int FROM public.member_works_dated_on_web('mbr_apNobody0001')), 0, 'a member with nothing returns nothing');
RESET ROLE;

-- A month or a year that overlaps the join day counts: the rule is in the app (one function), which reads these two columns.
SELECT is((SELECT achieved_on + interval '1 month' - interval '1 day' FROM public.member_milestones WHERE id = 'mlst_apMonth0001')::date::text, '2026-05-31', 'the last day of a stored month is computed from its first day');

-- All three are SECURITY DEFINER with a pinned search path, and the older readers (and the old backfill) are dropped.
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('member_works_dated', 'member_works_dated_to_members', 'member_works_dated_on_web') AND pronamespace = 'public'::regnamespace AND prosecdef AND proconfig @> ARRAY['search_path=""']), 3, 'all three pin an empty search path');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('member_works_shown', 'member_works_shown_to_members', 'member_works_shown_on_web', 'milestones_shown_to_members', 'propose_milestones_from_books') AND pronamespace = 'public'::regnamespace), 0, 'the older readers and the old backfill are dropped');

SELECT * FROM finish(true);
ROLLBACK;
