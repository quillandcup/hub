-- pgTAP tests for 20270606000000_chat_channels_last_message_at.sql: a conversation's last_message_at follows its newest
-- real message (replies included), never moves back for an older one, and ignores Slack notices and deleted messages.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

SELECT ok(NOT has_function_privilege('authenticated', 'chat_touch_channel_last_message()', 'EXECUTE'), 'members cannot run the trigger function');

INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('chn_AAAAAAAAlmc1', 'channel', 'public', false, 'lm-one', 'PGTAP_LM1'),
  ('chn_AAAAAAAAlmc2', 'channel', 'public', false, 'lm-two', 'PGTAP_LM2');
SELECT is((SELECT last_message_at FROM public.chat_channels WHERE id = 'chn_AAAAAAAAlmc1'), NULL, 'a conversation with no messages has none');

INSERT INTO public.chat_messages (id, channel_id, origin, slack_ts, created_at) VALUES
  ('msg_AAAAAAAAlmd1', 'chn_AAAAAAAAlmc1', 'slack', '1.1', '2026-01-02 10:00:00+00');
SELECT is((SELECT last_message_at FROM public.chat_channels WHERE id = 'chn_AAAAAAAAlmc1'), '2026-01-02 10:00:00+00'::timestamptz, 'the first message sets it');

INSERT INTO public.chat_messages (id, channel_id, origin, slack_ts, created_at, thread_root_id) VALUES
  ('msg_AAAAAAAAlmd2', 'chn_AAAAAAAAlmc1', 'slack', '1.2', '2026-01-03 10:00:00+00', 'msg_AAAAAAAAlmd1');
SELECT is((SELECT last_message_at FROM public.chat_channels WHERE id = 'chn_AAAAAAAAlmc1'), '2026-01-03 10:00:00+00'::timestamptz, 'a newer message, a reply included, moves it');

INSERT INTO public.chat_messages (id, channel_id, origin, slack_ts, created_at) VALUES
  ('msg_AAAAAAAAlmd3', 'chn_AAAAAAAAlmc1', 'slack', '1.3', '2026-01-01 10:00:00+00');
SELECT is((SELECT last_message_at FROM public.chat_channels WHERE id = 'chn_AAAAAAAAlmc1'), '2026-01-03 10:00:00+00'::timestamptz, 'an older message (a backfill) does not move it back');

INSERT INTO public.chat_messages (id, channel_id, origin, slack_ts, created_at, system_subtype) VALUES
  ('msg_AAAAAAAAlmd4', 'chn_AAAAAAAAlmc1', 'slack', '1.4', '2026-01-05 10:00:00+00', 'channel_join');
SELECT is((SELECT last_message_at FROM public.chat_channels WHERE id = 'chn_AAAAAAAAlmc1'), '2026-01-03 10:00:00+00'::timestamptz, 'a Slack notice does not count');

INSERT INTO public.chat_messages (id, channel_id, origin, slack_ts, created_at, deleted_at) VALUES
  ('msg_AAAAAAAAlmd5', 'chn_AAAAAAAAlmc1', 'slack', '1.5', '2026-01-06 10:00:00+00', now());
SELECT is((SELECT last_message_at FROM public.chat_channels WHERE id = 'chn_AAAAAAAAlmc1'), '2026-01-03 10:00:00+00'::timestamptz, 'a deleted message does not count');

SELECT is((SELECT last_message_at FROM public.chat_channels WHERE id = 'chn_AAAAAAAAlmc2'), NULL, 'another conversation is not touched');

SELECT * FROM finish(true);
ROLLBACK;
