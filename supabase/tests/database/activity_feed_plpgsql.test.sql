-- pgTAP tests for count_activity_feed / get_activity_feed after they became plpgsql (so each call is
-- planned with its member id instead of a generic plan: 20270306100000). Same answers as before:
-- an admin gets one member's activity counted and listed, a non-admin gets nothing.
-- Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feed-admin@example.test'),
  ('00000000-0000-4000-a000-00000000f1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feed-member@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', 'feed-admin@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000f1a2', 'feed-member@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_FeedAAAAAAA1', 'Feed Ada', 'feed-ada@example.test', now(), 'active'),
  ('mbr_FeedAAAAAAA2', 'Feed Bea', 'feed-bea@example.test', now(), 'active');
INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, occurred_at, source) VALUES
  ('mbr_FeedAAAAAAA1', 'note', 'general', 'Ada one', now() - interval '2 days', 'test'),
  ('mbr_FeedAAAAAAA1', 'note', 'general', 'Ada two', now() - interval '1 day', 'test'),
  ('mbr_FeedAAAAAAA1', 'note', 'general', 'Ada Slack', now() - interval '1 day', 'slack'),
  ('mbr_FeedAAAAAAA2', 'note', 'general', 'Bea one', now() - interval '1 day', 'test');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a1", "role": "authenticated"}', true);

SELECT is(
  (SELECT count_activity_feed(p_member_id := 'mbr_FeedAAAAAAA1', p_kinds := ARRAY['activity'])),
  3,
  'admin: counts only the member''s own activity'
);
SELECT is(
  (SELECT count_activity_feed(p_member_id := 'mbr_FeedAAAAAAA1', p_kinds := ARRAY['activity'], p_hide_slack := true)),
  2,
  'admin: p_hide_slack drops the Slack activity'
);
SELECT is(
  (SELECT array_agg(title ORDER BY title) FROM get_activity_feed(p_member_id := 'mbr_FeedAAAAAAA1', p_kinds := ARRAY['activity'], p_hide_slack := true)),
  ARRAY['Ada one', 'Ada two'],
  'admin: lists only the member''s non-Slack activity'
);
SELECT is(
  (SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedAAAAAAA1', p_kinds := ARRAY['activity'], p_limit := 1)),
  1,
  'admin: p_limit pages the list'
);

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a2", "role": "authenticated"}', true);

SELECT is(count_activity_feed(p_member_id := 'mbr_FeedAAAAAAA1'), 0, 'non-admin: count is 0');
SELECT is((SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedAAAAAAA1')), 0, 'non-admin: no rows');

RESET ROLE;
SELECT is(
  (SELECT l.lanname::text FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.proname = 'count_activity_feed' AND p.pronamespace = 'public'::regnamespace),
  'plpgsql',
  'count_activity_feed is plpgsql, so it is planned with the member id'
);

SELECT * FROM finish(true);
ROLLBACK;
