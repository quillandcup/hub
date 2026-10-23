-- pgTAP tests for 20261216000000_chat_unread_channel_ids.sql: the conversations with unread for a
-- member, newest first, with the same exclusions as chat_unread_counts (own messages, replies,
-- deleted messages, archived and left conversations), and nobody but the service role may call it.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

SELECT ok(
  NOT has_function_privilege('anon', 'chat_unread_channel_ids(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'chat_unread_channel_ids(text)', 'EXECUTE'),
  'members and visitors cannot call it'
);
SELECT ok(has_function_privilege('service_role', 'chat_unread_channel_ids(text)', 'EXECUTE'), 'the service role can');

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAe601', 'Unread Fern', 'unread-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAe602', 'Unread Gale', 'unread-gale@example.test', now(), 'active');

-- c1: unread (older). c2: unread (newer). c3: nothing new. c4: archived. c5: Fern left. c6: only her own, a reply and a deleted message.
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id, archived_at) VALUES
  ('chn_AAAAAAAAe6c1', 'channel', 'public', false, 'unr-one', 'PGTAP_U_ONE', NULL),
  ('chn_AAAAAAAAe6c2', 'channel', 'public', false, 'unr-two', 'PGTAP_U_TWO', NULL),
  ('chn_AAAAAAAAe6c3', 'channel', 'public', false, 'unr-read', 'PGTAP_U_READ', NULL),
  ('chn_AAAAAAAAe6c4', 'channel', 'public', false, 'unr-old', 'PGTAP_U_OLD', now()),
  ('chn_AAAAAAAAe6c5', 'channel', 'public', false, 'unr-left', 'PGTAP_U_LEFT', NULL),
  ('chn_AAAAAAAAe6c6', 'channel', 'public', false, 'unr-noise', 'PGTAP_U_NOISE', NULL);
INSERT INTO public.chat_channel_members (channel_id, member_id, joined_at, last_read_at, left_at) VALUES
  ('chn_AAAAAAAAe6c1', 'mbr_AAAAAAAAe601', '2019-01-01', '2020-01-01', NULL),
  ('chn_AAAAAAAAe6c2', 'mbr_AAAAAAAAe601', '2019-01-01', '2020-01-01', NULL),
  ('chn_AAAAAAAAe6c3', 'mbr_AAAAAAAAe601', '2019-01-01', '2020-03-01', NULL),
  ('chn_AAAAAAAAe6c4', 'mbr_AAAAAAAAe601', '2019-01-01', '2020-01-01', NULL),
  ('chn_AAAAAAAAe6c5', 'mbr_AAAAAAAAe601', '2019-01-01', '2020-01-01', '2020-01-02'),
  ('chn_AAAAAAAAe6c6', 'mbr_AAAAAAAAe601', '2019-01-01', '2020-01-01', NULL);

INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, slack_ts, created_at, deleted_at) VALUES
  ('msg_AAAAAAAAe6d1', 'chn_AAAAAAAAe6c1', 'mbr_AAAAAAAAe602', NULL, '3.1', '2020-02-01', NULL),
  ('msg_AAAAAAAAe6d2', 'chn_AAAAAAAAe6c2', 'mbr_AAAAAAAAe602', NULL, '3.2', '2020-02-02', NULL),
  ('msg_AAAAAAAAe6d3', 'chn_AAAAAAAAe6c3', 'mbr_AAAAAAAAe602', NULL, '3.3', '2020-02-03', NULL),
  ('msg_AAAAAAAAe6d4', 'chn_AAAAAAAAe6c4', 'mbr_AAAAAAAAe602', NULL, '3.4', '2020-02-04', NULL),
  ('msg_AAAAAAAAe6d5', 'chn_AAAAAAAAe6c5', 'mbr_AAAAAAAAe602', NULL, '3.5', '2020-02-05', NULL),
  ('msg_AAAAAAAAe6d6', 'chn_AAAAAAAAe6c6', 'mbr_AAAAAAAAe601', NULL, '3.6', '2020-02-06', NULL),
  ('msg_AAAAAAAAe6d7', 'chn_AAAAAAAAe6c6', 'mbr_AAAAAAAAe602', 'msg_AAAAAAAAe6d6', '3.7', '2020-02-07', NULL),
  ('msg_AAAAAAAAe6d8', 'chn_AAAAAAAAe6c6', 'mbr_AAAAAAAAe602', NULL, '3.8', '2020-02-08', '2020-02-09');

-- A join notice is a system message: it doesn't make a conversation unread (same as the badge).
INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, slack_ts, created_at, system_subtype) VALUES
  ('msg_AAAAAAAAe6d9', 'chn_AAAAAAAAe6c6', 'mbr_AAAAAAAAe602', NULL, '3.9', '2020-02-10', 'channel_join');

SELECT is(
  (SELECT string_agg(right(channel_id::text, 2), ',' ORDER BY newest_at DESC) FROM chat_unread_channel_ids('mbr_AAAAAAAAe601')),
  'c2,c1',
  'only conversations with unread, newest activity first; read, archived, left and own/reply/deleted-only ones are left out'
);
SELECT is(
  (SELECT newest_at::text FROM chat_unread_channel_ids('mbr_AAAAAAAAe601') WHERE right(channel_id::text, 2) = 'c1'),
  '2020-02-01 00:00:00+00',
  'with the time of the newest unread message'
);

UPDATE public.chat_channel_members SET last_read_at = '2020-02-02' WHERE channel_id = 'chn_AAAAAAAAe6c2' AND member_id = 'mbr_AAAAAAAAe601';
SELECT is(
  (SELECT string_agg(right(channel_id::text, 2), ',') FROM chat_unread_channel_ids('mbr_AAAAAAAAe601')),
  'c1',
  'a conversation drops out once the marker passes its newest message'
);

SELECT is(
  (SELECT count(*) FROM chat_unread_channel_ids('mbr_AAAAAAAAe602')),
  0::bigint,
  'a member in no conversations gets nothing'
);

SELECT * FROM finish(true);
ROLLBACK;
