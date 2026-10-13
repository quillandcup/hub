-- pgTAP tests for 20261027000000_chat_reactions_channel.sql: a reaction's channel_id is filled in
-- from its message on insert (whoever inserts it, and whichever way: the Hub's toggle or the Slack
-- projection), the column can't be left empty, and the backfill matches the message's channel.
-- Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000fc01', 'Chan Fern', 'chan-fern@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('00000000-0000-4000-a000-00000000fcc1', 'channel', 'public', false, 'chan-a', 'PGTAP_C_A'),
  ('00000000-0000-4000-a000-00000000fcc2', 'channel', 'public', false, 'chan-b', 'PGTAP_C_B');
INSERT INTO public.chat_messages (id, channel_id, author_member_id, slack_ts, created_at) VALUES
  ('00000000-0000-4000-a000-00000000fcd1', '00000000-0000-4000-a000-00000000fcc1', '00000000-0000-4000-a000-00000000fc01', '3.1', now()),
  ('00000000-0000-4000-a000-00000000fcd2', '00000000-0000-4000-a000-00000000fcc2', '00000000-0000-4000-a000-00000000fc01', '3.2', now());

-- Inserted without a channel_id, as every existing insert does.
INSERT INTO public.chat_reactions (message_id, member_id, emoji, created_at) VALUES
  ('00000000-0000-4000-a000-00000000fcd1', '00000000-0000-4000-a000-00000000fc01', 'tada', now());
INSERT INTO public.chat_reactions (message_id, slack_user_id, emoji, created_at) VALUES
  ('00000000-0000-4000-a000-00000000fcd2', 'U_CHAN', 'eyes', now());

SELECT is(
  (SELECT channel_id::text FROM chat_reactions WHERE emoji = 'tada' AND message_id = '00000000-0000-4000-a000-00000000fcd1'),
  '00000000-0000-4000-a000-00000000fcc1',
  'a reaction gets its message''s conversation'
);
SELECT is(
  (SELECT channel_id::text FROM chat_reactions WHERE emoji = 'eyes' AND message_id = '00000000-0000-4000-a000-00000000fcd2'),
  '00000000-0000-4000-a000-00000000fcc2',
  'including a Slack-keyed one, in another conversation'
);

-- A value given by the inserter is replaced, not trusted.
INSERT INTO public.chat_reactions (message_id, member_id, emoji, created_at, channel_id) VALUES
  ('00000000-0000-4000-a000-00000000fcd1', '00000000-0000-4000-a000-00000000fc01', 'heart', now(), '00000000-0000-4000-a000-00000000fcc2');
SELECT is(
  (SELECT channel_id::text FROM chat_reactions WHERE emoji = 'heart' AND message_id = '00000000-0000-4000-a000-00000000fcd1'),
  '00000000-0000-4000-a000-00000000fcc1',
  'a wrong channel_id from the inserter is replaced by the message''s'
);

-- The Slack projection's upsert goes through the same trigger.
INSERT INTO bronze.slack_reactions (channel_id, message_ts, user_id, reaction, occurred_at, raw_payload) VALUES
  ('PGTAP_C_A', '3.1', 'U_CHAN', 'fire', now(), '{}');
SELECT project_slack_chat_message('PGTAP_C_A', '3.1');
SELECT is(
  (SELECT channel_id::text FROM chat_reactions WHERE emoji = 'fire' AND message_id = '00000000-0000-4000-a000-00000000fcd1'),
  '00000000-0000-4000-a000-00000000fcc1',
  'a reaction projected from Slack gets it too'
);

SELECT ok(
  (SELECT is_nullable = 'NO' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_reactions' AND column_name = 'channel_id'),
  'and the column is never empty'
);

SELECT * FROM finish(true);
ROLLBACK;
