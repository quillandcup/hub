-- pgTAP tests for 20261019000000_slack_activities_credit_hub_posts.sql: a message written in the Hub
-- is posted to Slack by the bot, and the Slack activity rebuild credits it to the member who wrote
-- it (the app-origin chat_messages row for the same channel and ts), not to nobody. Other bot posts
-- still count for nobody, and messages from mapped Slack users are unchanged.
-- Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f801', 'Hub Fern', 'hub-fern@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f802', 'Hub Gale', 'hub-gale@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('00000000-0000-4000-a000-00000000f8c1', 'channel', 'public', false, 'hub-posts', 'PGTAP_H_CHAN');

-- Posted from the Hub by Fern (sent: the ts is stored), posted from the Hub then deleted,
-- some other app's post, and a message Gale wrote in Slack herself.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, slack_ts, created_at, origin, slack_sync_status, deleted_at) VALUES
  ('00000000-0000-4000-a000-00000000f8d1', '00000000-0000-4000-a000-00000000f8c1', '00000000-0000-4000-a000-00000000f801', '8.1', '2030-01-01 10:00', 'app', 'sent', NULL),
  ('00000000-0000-4000-a000-00000000f8d2', '00000000-0000-4000-a000-00000000f8c1', '00000000-0000-4000-a000-00000000f801', '8.2', '2030-01-01 10:01', 'app', 'sent', '2030-01-01 10:05');
INSERT INTO bronze.slack_messages (channel_id, message_ts, user_id, text, message_type, occurred_at, deleted_at, raw_payload) VALUES
  ('PGTAP_H_CHAN', '8.1', 'B_BOT', 'from the hub', 'message', '2030-01-01 10:00', NULL, '{}'),
  ('PGTAP_H_CHAN', '8.2', 'B_BOT', 'from the hub, deleted', 'message', '2030-01-01 10:01', '2030-01-01 10:05', '{}'),
  ('PGTAP_H_CHAN', '8.3', 'B_BOT', 'some other app', 'message', '2030-01-01 10:02', NULL, '{}'),
  ('PGTAP_H_CHAN', '8.4', 'U_GALE', 'from slack', 'message', '2030-01-01 10:03', NULL, '{}');

SELECT is(
  (SELECT (reprocess_slack_activities_atomic('2030-01-01', '2030-01-02', '{"U_GALE": "00000000-0000-4000-a000-00000000f802"}'::jsonb, true))->>'messages'),
  '2',
  'two messages count: the Hub post and Gale''s own'
);
SELECT is(
  (SELECT member_id::text FROM member_activities WHERE source = 'slack' AND related_id = 'PGTAP_H_CHAN:8.1'),
  '00000000-0000-4000-a000-00000000f801',
  'a Hub post is credited to the member who wrote it, not to the bot'
);
SELECT is(
  (SELECT count(*) FROM member_activities WHERE source = 'slack' AND related_id = 'PGTAP_H_CHAN:8.3'),
  0::bigint,
  'another app''s post still counts for nobody'
);
SELECT is(
  (SELECT count(*) FROM member_activities WHERE source = 'slack' AND related_id = 'PGTAP_H_CHAN:8.2'),
  0::bigint,
  'a deleted Hub post is left out like any deleted message'
);
SELECT is(
  (SELECT member_id::text FROM member_activities WHERE source = 'slack' AND related_id = 'PGTAP_H_CHAN:8.4'),
  '00000000-0000-4000-a000-00000000f802',
  'a message from a mapped Slack user is credited as before'
);

SELECT * FROM finish(true);
ROLLBACK;
