-- pgTAP tests for 20261022000000_chat_reaction_fixes.sql:
--  * project_slack_chat_message projects the Slack reactions of a message the chat knows even when
--    Bronze has no row for it (a Hub post made through the bot), and still does nothing for a message
--    neither knows;
--  * chat_toggle_reaction counts a reaction the member made in Slack as theirs: toggling takes it away
--    (and any Hub row) instead of adding a second one, and toggling again adds the Hub reaction.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fba1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rfix-fern@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000fba1', 'rfix-fern@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000fb01', 'Fix Fern', 'rfix-fern@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('00000000-0000-4000-a000-00000000fbc1', 'channel', 'public', false, 'rfix', 'PGTAP_RF_CHAN');
-- The chat knows this message (posted from the Hub); Bronze does not.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, slack_ts, created_at, origin, slack_sync_status) VALUES
  ('00000000-0000-4000-a000-00000000fbd1', '00000000-0000-4000-a000-00000000fbc1', '00000000-0000-4000-a000-00000000fb01', '5.1', now(), 'app', 'sent');
INSERT INTO public.chat_slack_authors (slack_user_id, member_id) VALUES ('U_RFIX', '00000000-0000-4000-a000-00000000fb01');
INSERT INTO bronze.slack_reactions (channel_id, message_ts, user_id, reaction, occurred_at, raw_payload) VALUES
  ('PGTAP_RF_CHAN', '5.1', 'U_RFIX', 'tada', now(), '{}'),
  ('PGTAP_RF_CHAN', '5.9', 'U_RFIX', 'eyes', now(), '{}');

SELECT is(
  (SELECT (project_slack_chat_message('PGTAP_RF_CHAN', '5.1'))->>'projected'),
  'true',
  'a message the chat knows is projected even though Bronze has no row for it'
);
SELECT is(
  (SELECT concat_ws('|', emoji, slack_user_id, member_id::text, (deleted_at IS NULL)::text) FROM chat_reactions WHERE message_id = '00000000-0000-4000-a000-00000000fbd1'),
  'tada|U_RFIX|00000000-0000-4000-a000-00000000fb01|true',
  'its Slack reaction shows, credited to the member Slack user maps to'
);
SELECT is(
  (SELECT (project_slack_chat_message('PGTAP_RF_CHAN', '5.9'))->>'projected'),
  'false',
  'a message neither the chat nor Bronze knows is left alone'
);
SELECT is((SELECT count(*) FROM chat_messages WHERE channel_id = '00000000-0000-4000-a000-00000000fbc1'), 1::bigint, 'and no message was invented for it');
SELECT is(
  (SELECT count(*) FROM chat_message_contents WHERE message_id = '00000000-0000-4000-a000-00000000fbd1'),
  0::bigint,
  'the Hub row''s content is not touched when Bronze has none'
);

-- Toggling a reaction the member made in Slack takes it away, then adds a Hub reaction.
CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES ('00000000-0000-4000-a000-00000000fbc1', '00000000-0000-4000-a000-00000000fb01');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fba1", "email": "rfix-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'first', chat_toggle_reaction('00000000-0000-4000-a000-00000000fbd1', 'tada')::text;
RESET ROLE;
SELECT is((SELECT value FROM result WHERE label = 'first'), 'false', 'pressing a reaction you made in Slack removes it');
SELECT is(
  (SELECT concat_ws('|', count(*) FILTER (WHERE slack_user_id IS NULL), count(*) FILTER (WHERE deleted_at IS NULL)) FROM chat_reactions WHERE message_id = '00000000-0000-4000-a000-00000000fbd1'),
  '0|0',
  'without leaving a second (Hub) reaction behind, and the Slack one is no longer live'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fba1", "email": "rfix-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'second', chat_toggle_reaction('00000000-0000-4000-a000-00000000fbd1', 'tada')::text;
RESET ROLE;
SELECT is((SELECT value FROM result WHERE label = 'second'), 'true', 'pressing it again adds your reaction');
SELECT is(
  (SELECT count(*) FROM chat_reactions WHERE message_id = '00000000-0000-4000-a000-00000000fbd1' AND slack_user_id IS NULL AND deleted_at IS NULL AND NOT synced_to_slack),
  1::bigint,
  'as a Hub reaction waiting to be sent to Slack'
);

SELECT * FROM finish(true);
ROLLBACK;
