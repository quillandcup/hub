-- pgTAP tests for 20261203000000_chat_system_messages.sql:
--  * a channel-change notice projected from Bronze is marked with its subtype, a plain message is not;
--  * the activity rebuild turns the plain message into an activity and skips the notice.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000fda1', 'System Fern', 'system-fern@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('00000000-0000-4000-a000-00000000fdc1', 'channel', 'public', false, 'system-chan', 'PGTAP_SYS_CHAN');

SELECT ok(public.slack_is_system_message_type('channel_name') AND public.slack_is_system_message_type('group_archive'), 'rename and archive notices are system messages');
SELECT ok(NOT public.slack_is_system_message_type('message') AND NOT public.slack_is_system_message_type(NULL), 'plain messages and null are not');

INSERT INTO bronze.slack_messages (message_ts, channel_id, channel_name, channel_type, user_id, text, message_type, occurred_at, raw_payload) VALUES
  ('4070908800.000100', 'PGTAP_SYS_CHAN', 'system-chan', 'public_channel', 'U_SYS_FERN', '<@U_SYS_FERN> has renamed the channel from "a" to "b"', 'channel_name', '2099-01-01T00:00:00Z', '{}'),
  ('4070908800.000200', 'PGTAP_SYS_CHAN', 'system-chan', 'public_channel', 'U_SYS_FERN', 'one of those moments', 'message', '2099-01-01T01:00:00Z', '{}');
SELECT project_slack_chat_message('PGTAP_SYS_CHAN', '4070908800.000100');
SELECT project_slack_chat_message('PGTAP_SYS_CHAN', '4070908800.000200');

SELECT is(
  (SELECT system_subtype FROM chat_messages WHERE slack_ts = '4070908800.000100'),
  'channel_name',
  'a projected notice is marked with its subtype'
);
SELECT is(
  (SELECT system_subtype FROM chat_messages WHERE slack_ts = '4070908800.000200'),
  NULL,
  'a plain message is not'
);

SELECT reprocess_slack_activities_atomic(
  '2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z',
  '{"U_SYS_FERN": "00000000-0000-4000-a000-00000000fda1"}'::jsonb
);
SELECT is(
  (SELECT array_agg(data->>'message_ts' ORDER BY data->>'message_ts') FROM member_activities
   WHERE source = 'slack' AND data->>'channel_id' = 'PGTAP_SYS_CHAN'),
  ARRAY['4070908800.000200'],
  'only the plain message becomes an activity'
);

SELECT * FROM finish(true);
ROLLBACK;
