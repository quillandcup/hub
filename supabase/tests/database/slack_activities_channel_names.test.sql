-- pgTAP tests for 20261104000000_slack_activities_channel_names.sql: a message whose own
-- channel_name is empty (every webhook message) gets the channel's name from bronze.slack_channels in
-- the activity title and data, a name stored on the message still wins, and direct messages stay
-- nameless. Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f901', 'Name Fern', 'name-fern@example.test', now(), 'active');
INSERT INTO bronze.slack_channels (channel_id, name, raw_payload) VALUES
  ('PGTAP_N_CHAN', 'writing-sprints', '{}');
INSERT INTO bronze.slack_messages (channel_id, message_ts, user_id, text, message_type, occurred_at, channel_name, channel_type, raw_payload) VALUES
  ('PGTAP_N_CHAN', '9.1', 'U_FERN', 'via the webhook', 'message', '2030-01-01 10:00', NULL, 'channel', '{}'),
  ('PGTAP_N_CHAN', '9.2', 'U_FERN', 'empty string', 'message', '2030-01-01 10:01', '', 'channel', '{}'),
  ('PGTAP_N_CHAN', '9.3', 'U_FERN', 'from the importer', 'message', '2030-01-01 10:02', 'renamed-since', 'channel', '{}'),
  ('PGTAP_N_DM', '9.4', 'U_FERN', 'a direct message', 'message', '2030-01-01 10:03', NULL, 'im', '{}');

SELECT reprocess_slack_activities_atomic('2030-01-01', '2030-01-02', '{"U_FERN": "00000000-0000-4000-a000-00000000f901"}'::jsonb, true);

SELECT is(
  (SELECT title || '|' || (data ->> 'channel_name') FROM member_activities WHERE source = 'slack' AND related_id = 'PGTAP_N_CHAN:9.1'),
  'Posted in #writing-sprints|writing-sprints',
  'a webhook message (no stored name) takes the channel''s name from slack_channels'
);
SELECT is(
  (SELECT data ->> 'channel_name' FROM member_activities WHERE source = 'slack' AND related_id = 'PGTAP_N_CHAN:9.2'),
  'writing-sprints',
  'an empty stored name counts as missing'
);
SELECT is(
  (SELECT data ->> 'channel_name' FROM member_activities WHERE source = 'slack' AND related_id = 'PGTAP_N_CHAN:9.3'),
  'renamed-since',
  'a name stored on the message still wins'
);
SELECT is(
  (SELECT title FROM member_activities WHERE source = 'slack' AND related_id = 'PGTAP_N_DM:9.4'),
  'Sent a direct message',
  'a direct message keeps its generic title'
);
SELECT is(
  (SELECT data ->> 'channel_name' FROM member_activities WHERE source = 'slack' AND related_id = 'PGTAP_N_DM:9.4'),
  NULL,
  'and no channel name'
);

SELECT * FROM finish(true);
ROLLBACK;
