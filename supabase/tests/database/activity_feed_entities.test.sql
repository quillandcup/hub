-- pgTAP tests for 20270503000000_activity_feed_entities.sql: the Activity Log's activity rows say what their source
-- is, so the log can link to it. A check-in or attendance is about a prickle (the prickle column, else the related id);
-- a feedback submission is about feedback; anything else has no entity, as before.
-- Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f3a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ent-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES ('00000000-0000-4000-a000-00000000f3a1', 'ent-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES ('mbr_EntAAAAAAAA1', 'Ent Ada', 'ent-ada@example.test', now(), 'active');
INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, occurred_at, source, related_id) VALUES
  ('mbr_EntAAAAAAAA1', 'prickle_attended', 'event', 'Attended', now() - interval '5 hours', 'prickle_attendance', 'prkl_EntAAAAAAA01'),
  ('mbr_EntAAAAAAAA1', 'feedback_submitted', 'communication', 'Sent feedback: idea', now() - interval '4 hours', 'feedback', 'b9f3a6c2-0000-4000-8000-000000000001'),
  ('mbr_EntAAAAAAAA1', 'note', 'general', 'Plain', now() - interval '3 hours', 'test', NULL);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f3a1", "role": "authenticated"}', true);

SELECT is(
  (SELECT entity_type || ':' || entity_id FROM get_activity_feed(p_member_id := 'mbr_EntAAAAAAAA1', p_kinds := ARRAY['activity']) WHERE title = 'Attended'),
  'prickle:prkl_EntAAAAAAA01',
  'an attendance is about its prickle'
);
SELECT is(
  (SELECT entity_type FROM get_activity_feed(p_member_id := 'mbr_EntAAAAAAAA1', p_kinds := ARRAY['activity']) WHERE title = 'Sent feedback: idea'),
  'feedback',
  'a feedback submission is about feedback'
);
SELECT is(
  (SELECT entity_id FROM get_activity_feed(p_member_id := 'mbr_EntAAAAAAAA1', p_kinds := ARRAY['activity']) WHERE title = 'Sent feedback: idea'),
  'b9f3a6c2-0000-4000-8000-000000000001',
  'with the feedback id'
);
SELECT ok(
  (SELECT entity_type IS NULL AND entity_id IS NULL FROM get_activity_feed(p_member_id := 'mbr_EntAAAAAAAA1', p_kinds := ARRAY['activity']) WHERE title = 'Plain'),
  'anything else has no entity'
);
SELECT is(
  (SELECT count_activity_feed(p_member_id := 'mbr_EntAAAAAAAA1', p_kinds := ARRAY['activity'])),
  3,
  'the count is unchanged'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM pg_proc WHERE proname = 'get_activity_feed' AND pronamespace = 'public'::regnamespace),
  1,
  'there is still one get_activity_feed (the signature did not change)'
);

SELECT * FROM finish(true);
ROLLBACK;
