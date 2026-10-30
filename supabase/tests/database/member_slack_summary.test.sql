-- pgTAP tests for member_slack_summary (20270307100000) and member_slack_channels (20270307200000): totals over all of one member's Slack
-- activities, scoped by RLS (an admin counts any member's, a member only their own).
-- Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f5a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'slack-sum-admin@example.test'),
  ('00000000-0000-4000-a000-00000000f5a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'slack-sum-member@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f5a1', 'slack-sum-admin@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000f5a2', 'slack-sum-member@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_SlkSumAAAA1', 'Sum Ada', 'slack-sum-ada@example.test', now(), 'active', NULL),
  ('mbr_SlkSumAAAA2', 'Sum Bea', 'slack-sum-bea@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f5a2');
INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, occurred_at, source, data) VALUES
  ('mbr_SlkSumAAAA1', 'slack_message', 'communication', 'm1', now() - interval '40 days', 'slack', '{"channel_name": "random"}'),
  ('mbr_SlkSumAAAA1', 'slack_thread_reply', 'communication', 'm2', now() - interval '2 days', 'slack', '{"channel_name": "writing"}'),
  ('mbr_SlkSumAAAA1', 'slack_reaction', 'communication', 'r1', now() - interval '1 day', 'slack', '{"channel_name": "writing"}'),
  ('mbr_SlkSumAAAA1', 'note', 'general', 'not slack', now() - interval '1 day', 'test', '{"channel_name": "elsewhere"}'),
  ('mbr_SlkSumAAAA2', 'slack_message', 'communication', 'b1', now() - interval '1 day', 'slack', '{"channel_name": "random"}');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a1", "role": "authenticated"}', true);

SELECT results_eq(
  $$SELECT total, messages, reactions, channels, last_30_days FROM public.member_slack_summary('mbr_SlkSumAAAA1', now() - interval '30 days')$$,
  $$VALUES (3::bigint, 2::bigint, 1::bigint, 2::bigint, 2::bigint)$$,
  'an admin gets one member''s Slack totals, Slack source only'
);
SELECT results_eq(
  $$SELECT total FROM public.member_slack_summary('mbr_NoSuchMember', now())$$,
  $$VALUES (0::bigint)$$,
  'a member with no Slack activity counts zero'
);

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a2", "role": "authenticated"}', true);

SELECT results_eq(
  $$SELECT total FROM public.member_slack_summary('mbr_SlkSumAAAA2', now() - interval '30 days')$$,
  $$VALUES (1::bigint)$$,
  'a member counts their own'
);
SELECT results_eq(
  $$SELECT total FROM public.member_slack_summary('mbr_SlkSumAAAA1', now() - interval '30 days')$$,
  $$VALUES (0::bigint)$$,
  'a member does not count another member''s (RLS)'
);

SELECT is_empty(
  $$SELECT * FROM public.member_slack_channels('mbr_SlkSumAAAA1')$$,
  'member_slack_channels: a member does not see another member''s channels (RLS)'
);

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a1", "role": "authenticated"}', true);

SELECT results_eq(
  $$SELECT channel_name, n FROM public.member_slack_channels('mbr_SlkSumAAAA1')$$,
  $$VALUES ('writing'::text, 2::bigint), ('random'::text, 1::bigint)$$,
  'member_slack_channels: an admin gets the channels busiest first, Slack source only'
);

SELECT * FROM finish(true);
ROLLBACK;
