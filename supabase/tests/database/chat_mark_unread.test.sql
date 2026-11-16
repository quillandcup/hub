-- pgTAP tests for 20270723000000_chat_mark_unread.sql: chat_mark_unread moves only the caller's own
-- marker, only backward, to just before the message, and refuses non-members and non-top-level messages.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

SELECT ok(NOT has_function_privilege('anon', 'chat_mark_unread(text, text)', 'EXECUTE'), 'anon cannot call it');
SELECT ok(has_function_privilege('authenticated', 'chat_mark_unread(text, text)', 'EXECUTE'), 'authenticated can call it');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'unread-fern@example.test'),
  ('00000000-0000-4000-a000-00000000f7a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'unread-gale@example.test'),
  ('00000000-0000-4000-a000-00000000f7a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'unread-out@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', 'unread-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f7a2', 'unread-gale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f7a3', 'unread-out@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAf7A1', 'Unread Fern', 'unread-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAf7A2', 'Unread Gale', 'unread-gale@example.test', now(), 'active'),
  ('mbr_AAAAAAAAf7A3', 'Unread Out', 'unread-out@example.test', now(), 'active');

INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('chn_AAAAAAAAf7c1', 'channel', 'public', false, 'unread-live', 'PGTAP_U_LIVE');
INSERT INTO public.chat_channel_members (channel_id, member_id, joined_at, last_read_at) VALUES
  ('chn_AAAAAAAAf7c1', 'mbr_AAAAAAAAf7A1', '2019-01-01', '2020-03-01'),
  ('chn_AAAAAAAAf7c1', 'mbr_AAAAAAAAf7A2', '2019-01-01', '2020-03-01');
INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, slack_ts, created_at, deleted_at) VALUES
  ('msg_AAAAAAAAf7d1', 'chn_AAAAAAAAf7c1', 'mbr_AAAAAAAAf7A2', NULL, '3.1', '2020-02-01 10:00:00.123456+00', NULL),
  ('msg_AAAAAAAAf7d2', 'chn_AAAAAAAAf7c1', 'mbr_AAAAAAAAf7A2', NULL, '3.2', '2020-02-02', NULL),
  ('msg_AAAAAAAAf7d3', 'chn_AAAAAAAAf7c1', 'mbr_AAAAAAAAf7A2', 'msg_AAAAAAAAf7d1', '3.3', '2020-02-03', NULL),
  ('msg_AAAAAAAAf7d4', 'chn_AAAAAAAAf7c1', 'mbr_AAAAAAAAf7A2', NULL, '3.4', '2020-02-04', '2020-02-05'),
  ('msg_AAAAAAAAf7d5', 'chn_AAAAAAAAf7c1', 'mbr_AAAAAAAAf7A2', NULL, '3.5', '2020-04-01', NULL);

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "unread-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'back', chat_mark_unread('chn_AAAAAAAAf7c1', 'msg_AAAAAAAAf7d1')::text;
INSERT INTO result SELECT 'count', string_agg(unread::text, ',') FROM chat_unread_counts();
INSERT INTO result SELECT 'forward', chat_mark_unread('chn_AAAAAAAAf7c1', 'msg_AAAAAAAAf7d5')::text;
INSERT INTO result SELECT 'refused', coalesce(chat_mark_unread('chn_AAAAAAAAf7c1', 'msg_AAAAAAAAf7d3')::text, 'null')
  || coalesce(chat_mark_unread('chn_AAAAAAAAf7c1', 'msg_AAAAAAAAf7d4')::text, 'null')
  || coalesce(chat_mark_unread('chn_AAAAAAAAf7zz', 'msg_AAAAAAAAf7d1')::text, 'null');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a3", "email": "unread-out@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'non member', coalesce(chat_mark_unread('chn_AAAAAAAAf7c1', 'msg_AAAAAAAAf7d1')::text, 'null');
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'back')::timestamptz, '2020-02-01 10:00:00.123455+00'::timestamptz, 'the marker moves to a microsecond before the message');
SELECT is((SELECT value FROM result WHERE label = 'count'), '3', 'that message and the later top-level ones count as unread again');
SELECT is((SELECT value FROM result WHERE label = 'forward')::timestamptz, '2020-02-01 10:00:00.123455+00'::timestamptz, 'a message after the marker never moves it forward');
SELECT is((SELECT value FROM result WHERE label = 'refused'), 'nullnullnull', 'a reply, a deleted message or a message of another conversation is refused');
SELECT is((SELECT value FROM result WHERE label = 'non member'), 'null', 'a non-member gets nothing');
SELECT is((SELECT last_read_at FROM chat_channel_members WHERE channel_id = 'chn_AAAAAAAAf7c1' AND member_id = 'mbr_AAAAAAAAf7A2'), '2020-03-01'::timestamptz, 'another member''s marker is untouched');
SELECT is((SELECT count(*) FROM chat_channel_members WHERE channel_id = 'chn_AAAAAAAAf7c1' AND member_id = 'mbr_AAAAAAAAf7A3'), 0::bigint, 'a non-member got no membership row');

SELECT * FROM finish(true);
ROLLBACK;
