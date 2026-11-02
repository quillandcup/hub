-- pgTAP tests for 20270419000000_admin_chat_adoption.sql: messages written in the Hub vs in Slack, by week and per person.
--   * the Hub's messages (origin app) and Slack's are counted apart, with distinct authors;
--   * deleted messages, system messages and restricted conversations (direct messages) are left out;
--   * the week starts on Sunday in the given time zone;
--   * only admins get rows.
-- The fixtures are dated in 2020 so real rows in a shared database don't mix in. Runs in one transaction that is
-- rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000ca01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chatadopt-admin@example.test'),
  ('00000000-0000-4000-a000-00000000ca02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chatadopt-plain@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000ca01', 'chatadopt-admin@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000ca02', 'chatadopt-plain@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, display_name, email, joined_at, status) VALUES
  ('mbr_CADAAAAAAAA1', 'Chat Ada', 'Ada C', 'chatadopt-ada@example.test', now(), 'active'),
  ('mbr_CADAAAAAAAA2', 'Chat Bea', NULL, 'chatadopt-bea@example.test', now(), 'active'),
  ('mbr_CADAAAAAAAA3', 'Chat Cy', NULL, 'chatadopt-cy@example.test', now(), 'active');

INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id, bridge_disabled, bridge_mode) VALUES
  ('chn_CADAAAAAAAc1', 'channel', 'public', false, 'chatadopt-open', 'PGTAP_CA_OPEN', false, 'bridged'),
  ('chn_CADAAAAAAAc2', 'dm', 'private', true, NULL, 'PGTAP_CA_DM', false, 'bridged');

-- Ada: two in the Hub, one in Slack; a Hub one she deleted, a system message and a Slack one in a direct message don't count.
-- Bea: three in Slack. Cy: nothing. 2020-01-05 is a Sunday; 2020-01-12 the next.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, slack_ts, created_at, origin, slack_sync_status, deleted_at, system_subtype) VALUES
  ('msg_CADAAAAAAAd1', 'chn_CADAAAAAAAc1', 'mbr_CADAAAAAAAA1', NULL, '2020-01-06 15:00+00', 'app', 'sent', NULL, NULL),
  ('msg_CADAAAAAAAd2', 'chn_CADAAAAAAAc1', 'mbr_CADAAAAAAAA1', NULL, '2020-01-11 15:00+00', 'app', 'sent', NULL, NULL),
  ('msg_CADAAAAAAAd3', 'chn_CADAAAAAAAc1', 'mbr_CADAAAAAAAA1', '9.3', '2020-01-12 15:00+00', 'slack', NULL, NULL, NULL),
  ('msg_CADAAAAAAAd4', 'chn_CADAAAAAAAc1', 'mbr_CADAAAAAAAA1', NULL, '2020-01-06 16:00+00', 'app', 'sent', now(), NULL),
  ('msg_CADAAAAAAAd5', 'chn_CADAAAAAAAc1', 'mbr_CADAAAAAAAA1', '9.5', '2020-01-06 17:00+00', 'slack', NULL, NULL, 'channel_join'),
  ('msg_CADAAAAAAAd6', 'chn_CADAAAAAAAc2', 'mbr_CADAAAAAAAA1', '9.6', '2020-01-06 18:00+00', 'slack', NULL, NULL, NULL),
  ('msg_CADAAAAAAAd7', 'chn_CADAAAAAAAc1', 'mbr_CADAAAAAAAA2', '9.7', '2020-01-07 15:00+00', 'slack', NULL, NULL, NULL),
  ('msg_CADAAAAAAAd8', 'chn_CADAAAAAAAc1', 'mbr_CADAAAAAAAA2', '9.8', '2020-01-08 15:00+00', 'slack', NULL, NULL, NULL),
  ('msg_CADAAAAAAAd9', 'chn_CADAAAAAAAc1', 'mbr_CADAAAAAAAA2', '9.9', '2020-01-12 16:00+00', 'slack', NULL, NULL, NULL);

CREATE TEMP TABLE weekly(week_start date, hub_messages bigint, slack_messages bigint, hub_authors bigint, slack_authors bigint) ON COMMIT DROP;
CREATE TEMP TABLE people(member_id text, name text, display_name text, hub_messages bigint, slack_messages bigint) ON COMMIT DROP;
GRANT INSERT ON weekly, people TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ca01", "email": "chatadopt-admin@example.test", "role": "authenticated"}', true);
INSERT INTO weekly SELECT * FROM public.admin_chat_adoption_weekly('2020-01-01', 'America/New_York') WHERE week_start < '2021-01-01';
INSERT INTO people SELECT * FROM public.admin_chat_adoption_people('2020-01-01') WHERE member_id LIKE 'mbr_CAD%';
RESET ROLE;

SELECT is((SELECT count(*) FROM weekly), 2::bigint, 'two weeks have messages');
SELECT is((SELECT hub_messages || '/' || slack_messages || '/' || hub_authors || '/' || slack_authors FROM weekly WHERE week_start = '2020-01-05'),
  '2/2/1/1', 'the week of Sunday 5 Jan: two from the Hub, two from Slack (Bea''s two), one author each; the deleted, system and direct messages are left out');
SELECT is((SELECT hub_messages || '/' || slack_messages FROM weekly WHERE week_start = '2020-01-12'), '0/2', 'the next week starts on the Sunday: Ada''s and Bea''s Slack messages');
SELECT is((SELECT count(*) FROM people), 2::bigint, 'two people wrote something that counts; Cy did not');
SELECT is((SELECT hub_messages || '/' || slack_messages FROM people WHERE member_id = 'mbr_CADAAAAAAAA1'), '2/1', 'Ada: two in the Hub, one in Slack');
SELECT is((SELECT hub_messages || '/' || slack_messages || '/' || name FROM people WHERE member_id = 'mbr_CADAAAAAAAA2'), '0/3/Chat Bea', 'Bea: three in Slack, with her name');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ca02", "email": "chatadopt-plain@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*) FROM public.admin_chat_adoption_weekly('2020-01-01', 'America/New_York')), 0::bigint, 'a member gets no weeks');
SELECT is((SELECT count(*) FROM public.admin_chat_adoption_people('2020-01-01')), 0::bigint, 'and no people');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.admin_chat_adoption_people(timestamptz)', 'EXECUTE'), 'a signed-out visitor can''t run it');

SELECT * FROM finish(true);
ROLLBACK;
