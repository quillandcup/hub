-- pgTAP tests for 20261017000000_chat_read_state.sql: unread counts per conversation for the caller
-- (own messages, replies, deleted messages, archived and left conversations don't count; a new
-- membership counts from when it began), and chat_mark_read only ever moves the caller's own marker.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(11);

SELECT ok(NOT has_function_privilege('anon', 'chat_mark_read(text, timestamptz)', 'EXECUTE') AND NOT has_function_privilege('anon', 'chat_unread_counts()', 'EXECUTE'), 'anon can call neither');
SELECT ok(has_function_privilege('authenticated', 'chat_mark_read(text, timestamptz)', 'EXECUTE') AND has_function_privilege('authenticated', 'chat_unread_counts()', 'EXECUTE'), 'authenticated can call both');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f6a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'read-fern@example.test'),
  ('00000000-0000-4000-a000-00000000f6a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'read-gale@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f6a1', 'read-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f6a2', 'read-gale@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAf6A1', 'Read Fern', 'read-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAf6A2', 'Read Gale', 'read-gale@example.test', now(), 'active');

-- c1: live. c2: archived. c3: Fern has left.
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id, archived_at) VALUES
  ('chn_AAAAAAAAf6c1', 'channel', 'public', false, 'read-live', 'PGTAP_R_LIVE', NULL),
  ('chn_AAAAAAAAf6c2', 'channel', 'public', false, 'read-old', 'PGTAP_R_OLD', now()),
  ('chn_AAAAAAAAf6c3', 'channel', 'public', false, 'read-left', 'PGTAP_R_LEFT', NULL);
INSERT INTO public.chat_channel_members (channel_id, member_id, joined_at, last_read_at, left_at) VALUES
  ('chn_AAAAAAAAf6c1', 'mbr_AAAAAAAAf6A1', '2019-01-01', '2020-01-01', NULL),
  ('chn_AAAAAAAAf6c2', 'mbr_AAAAAAAAf6A1', '2019-01-01', '2020-01-01', NULL),
  ('chn_AAAAAAAAf6c3', 'mbr_AAAAAAAAf6A1', '2019-01-01', '2020-01-01', '2020-01-02'),
  ('chn_AAAAAAAAf6c1', 'mbr_AAAAAAAAf6A2', '2020-03-01', NULL, NULL);

INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, slack_ts, created_at, deleted_at) VALUES
  ('msg_AAAAAAAAf6d1', 'chn_AAAAAAAAf6c1', 'mbr_AAAAAAAAf6A2', NULL, '2.1', '2020-02-01', NULL),
  ('msg_AAAAAAAAf6d2', 'chn_AAAAAAAAf6c1', 'mbr_AAAAAAAAf6A1', NULL, '2.2', '2020-02-02', NULL),
  ('msg_AAAAAAAAf6d3', 'chn_AAAAAAAAf6c1', 'mbr_AAAAAAAAf6A2', 'msg_AAAAAAAAf6d1', '2.3', '2020-02-03', NULL),
  ('msg_AAAAAAAAf6d4', 'chn_AAAAAAAAf6c1', 'mbr_AAAAAAAAf6A2', NULL, '2.4', '2020-02-04', '2020-02-05'),
  ('msg_AAAAAAAAf6d5', 'chn_AAAAAAAAf6c1', 'mbr_AAAAAAAAf6A2', NULL, '2.5', '2019-12-01', NULL),
  ('msg_AAAAAAAAf6d6', 'chn_AAAAAAAAf6c2', 'mbr_AAAAAAAAf6A2', NULL, '2.6', '2020-02-01', NULL),
  ('msg_AAAAAAAAf6d7', 'chn_AAAAAAAAf6c3', 'mbr_AAAAAAAAf6A2', NULL, '2.7', '2020-02-01', NULL);

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f6a1", "email": "read-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'fern before', coalesce(string_agg(right(channel_id::text, 2) || '=' || unread, ',' ORDER BY right(channel_id::text, 2)), '') FROM chat_unread_counts();

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f6a2", "email": "read-gale@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'gale before', coalesce(string_agg(right(channel_id::text, 2) || '=' || unread, ',' ORDER BY right(channel_id::text, 2)), '') FROM chat_unread_counts();
SELECT chat_mark_read('chn_AAAAAAAAf6c1');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f6a1", "email": "read-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'fern after gale marked', coalesce(string_agg(right(channel_id::text, 2) || '=' || unread, ',' ORDER BY right(channel_id::text, 2)), '') FROM chat_unread_counts();
SELECT chat_mark_read('chn_AAAAAAAAf6c1');
SELECT chat_mark_read('chn_AAAAAAAAf6c3');
INSERT INTO result SELECT 'fern after marking', coalesce(string_agg(right(channel_id::text, 2) || '=' || unread, ',' ORDER BY right(channel_id::text, 2)), '') FROM chat_unread_counts();
RESET ROLE;

-- Marking through a message: later ones stay unread, and the marker never moves backward.
UPDATE public.chat_channel_members SET last_read_at = '2020-01-01'
  WHERE channel_id = 'chn_AAAAAAAAf6c1' AND member_id = 'mbr_AAAAAAAAf6A1';
INSERT INTO public.chat_messages (id, channel_id, author_member_id, slack_ts, created_at) VALUES
  ('msg_AAAAAAAAf6d8', 'chn_AAAAAAAAf6c1', 'mbr_AAAAAAAAf6A2', '2.8', '2020-02-10');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f6a1", "email": "read-fern@example.test", "role": "authenticated"}', true);
SELECT chat_mark_read('chn_AAAAAAAAf6c1', '2020-02-01');
INSERT INTO result SELECT 'fern through', coalesce(string_agg(right(channel_id::text, 2) || '=' || unread, ',' ORDER BY right(channel_id::text, 2)), '') FROM chat_unread_counts();
SELECT chat_mark_read('chn_AAAAAAAAf6c1', '2019-01-01');
INSERT INTO result SELECT 'after earlier mark', last_read_at::text FROM chat_channel_members WHERE channel_id = 'chn_AAAAAAAAf6c1' AND member_id = 'mbr_AAAAAAAAf6A1';
SELECT chat_mark_read('chn_AAAAAAAAf6c1', '2999-01-01');
RESET ROLE;
SELECT is((SELECT value FROM result WHERE label = 'after earlier mark')::timestamptz, '2020-02-01'::timestamptz, 'the marker never moves backward');
SELECT ok((SELECT last_read_at FROM chat_channel_members WHERE channel_id = 'chn_AAAAAAAAf6c1' AND member_id = 'mbr_AAAAAAAAf6A1') <= now(), 'the marker never passes now()');

SELECT is((SELECT value FROM result WHERE label = 'fern before'), 'c1=1', 'only live, unread, top-level messages by others count (not own, replies, deleted, older than the marker, archived or left)');
SELECT is((SELECT value FROM result WHERE label = 'gale before'), '', 'a membership with no marker counts from when it began');
SELECT is((SELECT value FROM result WHERE label = 'fern after gale marked'), 'c1=1', 'marking read moves only the caller''s own marker');
SELECT is((SELECT value FROM result WHERE label = 'fern after marking'), '', 'marking a conversation read clears its count');
SELECT is((SELECT value FROM result WHERE label = 'fern through'), 'c1=1', 'marking through a message leaves later ones unread');
SELECT ok((SELECT last_read_at FROM chat_channel_members WHERE channel_id = 'chn_AAAAAAAAf6c3') = '2020-01-01', 'marking a conversation the member has left changes nothing');
SELECT ok((SELECT last_read_at FROM chat_channel_members WHERE channel_id = 'chn_AAAAAAAAf6c2') = '2020-01-01', 'marking one conversation leaves the member''s others alone');

SELECT * FROM finish(true);
ROLLBACK;
