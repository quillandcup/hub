-- pgTAP tests for 20261204000000_chat_author_follows_matching.sql: when a Slack user's member match
-- goes away (an alias deleted), re-projecting clears them as the author of their Slack messages and
-- reactions, while a Hub-written (app) message keeps its author. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000fc01', 'Match Fern', 'afm-fern@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('00000000-0000-4000-a000-00000000fcc1', 'channel', 'public', false, 'afm', 'PGTAP_AFM_CHAN');
INSERT INTO bronze.slack_messages (channel_id, message_ts, user_id, text, occurred_at, raw_payload) VALUES
  ('PGTAP_AFM_CHAN', '7.1', 'U_AFM', 'hello', now(), '{}'),
  ('PGTAP_AFM_CHAN', '7.2', 'U_AFM_BOT', 'from the hub', now(), '{}');
INSERT INTO bronze.slack_reactions (channel_id, message_ts, user_id, reaction, occurred_at, raw_payload) VALUES
  ('PGTAP_AFM_CHAN', '7.1', 'U_AFM', 'tada', now(), '{}');
-- 7.2 was written from the Hub: its author is the member, though Slack reports the bot.
INSERT INTO public.chat_messages (channel_id, author_member_id, slack_ts, created_at, origin, slack_sync_status) VALUES
  ('00000000-0000-4000-a000-00000000fcc1', '00000000-0000-4000-a000-00000000fc01', '7.2', now(), 'app', 'sent');

SELECT project_slack_chat_messages(now() - interval '1 day', now() + interval '1 day', '{"U_AFM": "00000000-0000-4000-a000-00000000fc01"}'::jsonb);
SELECT is(
  (SELECT author_member_id::text FROM chat_messages WHERE slack_ts = '7.1' AND channel_id = '00000000-0000-4000-a000-00000000fcc1'),
  '00000000-0000-4000-a000-00000000fc01',
  'a matched Slack user authors their message'
);
SELECT is(
  (SELECT member_id::text FROM chat_reactions WHERE slack_user_id = 'U_AFM'),
  '00000000-0000-4000-a000-00000000fc01',
  'and owns their reaction'
);

-- The alias is deleted: the next projection has no match for them.
SELECT project_slack_chat_messages(now() - interval '1 day', now() + interval '1 day', '{}'::jsonb);
SELECT is(
  (SELECT author_member_id FROM chat_messages WHERE slack_ts = '7.1' AND channel_id = '00000000-0000-4000-a000-00000000fcc1'),
  NULL::uuid,
  'the message loses its author once the match is gone'
);
SELECT is(
  (SELECT member_id FROM chat_reactions WHERE slack_user_id = 'U_AFM'),
  NULL::uuid,
  'and the reaction its owner'
);
SELECT is(
  (SELECT author_member_id::text FROM chat_messages WHERE slack_ts = '7.2' AND channel_id = '00000000-0000-4000-a000-00000000fcc1'),
  '00000000-0000-4000-a000-00000000fc01',
  'a Hub-written message keeps its author'
);

-- The single-message (webhook) path follows the match too.
DELETE FROM chat_slack_authors;
INSERT INTO chat_slack_authors (slack_user_id, member_id) VALUES ('U_AFM', '00000000-0000-4000-a000-00000000fc01');
SELECT project_slack_chat_message('PGTAP_AFM_CHAN', '7.1');
DELETE FROM chat_slack_authors;
SELECT project_slack_chat_message('PGTAP_AFM_CHAN', '7.1');
SELECT is(
  (SELECT author_member_id FROM chat_messages WHERE slack_ts = '7.1' AND channel_id = '00000000-0000-4000-a000-00000000fcc1'),
  NULL::uuid,
  'the one-message projection clears the author too'
);

SELECT * FROM finish(true);
ROLLBACK;
