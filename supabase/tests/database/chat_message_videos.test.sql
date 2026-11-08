-- pgTAP tests for 20270528000000_chat_message_videos.sql:
--  * whoever can read a message's content sees that it shares a lesson video, and nobody else does;
--  * signed-in members and signed-out visitors cannot write or read it directly (the share action writes it
--    with the service role after its own checks);
--  * a message shares at most one lesson video, and the row goes with its message or its lesson;
--  * the chat_videos feature flag exists and is off for everyone.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(10);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000ca01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cvideo-fern@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000ca01', 'cvideo-fern@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_PGTAPCVID001', 'Video Fern', 'cvideo-fern@example.test', now(), 'active');

INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('chn_PGTAPCVID001', 'channel', 'public', false, 'cvideo-open', 'PGTAP_CV_OPEN'),
  ('chn_PGTAPCVID002', 'channel', 'private', true, 'cvideo-closed', 'PGTAP_CV_CLOSED');
INSERT INTO public.chat_messages (id, channel_id, author_member_id, created_at, origin, slack_sync_status) VALUES
  ('msg_PGTAPCVID001', 'chn_PGTAPCVID001', 'mbr_PGTAPCVID001', now(), 'app', 'sent'),
  ('msg_PGTAPCVID002', 'chn_PGTAPCVID002', 'mbr_PGTAPCVID001', now(), 'app', 'sent'),
  ('msg_PGTAPCVID003', 'chn_PGTAPCVID001', 'mbr_PGTAPCVID001', now(), 'app', 'sent');
INSERT INTO public.chat_message_contents (message_id, body) VALUES
  ('msg_PGTAPCVID001', 'open'), ('msg_PGTAPCVID002', 'closed'), ('msg_PGTAPCVID003', 'third');

INSERT INTO public.courses (id, slug, title, source_key) VALUES ('crs_PGTAPCVID001', 'pgtap-cvideo', 'Video course', 'pgtap-cvideo');
INSERT INTO public.course_lessons (id, course_id, title, position, source_key) VALUES
  ('les_PGTAPCVID001', 'crs_PGTAPCVID001', 'Lesson one', 1, 'pgtap-cvideo-1'),
  ('les_PGTAPCVID002', 'crs_PGTAPCVID001', 'Lesson two', 2, 'pgtap-cvideo-2');

INSERT INTO public.chat_message_videos (message_id, lesson_id) VALUES
  ('msg_PGTAPCVID001', 'les_PGTAPCVID001'),
  ('msg_PGTAPCVID002', 'les_PGTAPCVID001');

SELECT throws_ok(
  $$INSERT INTO public.chat_message_videos (message_id, lesson_id) VALUES ('msg_PGTAPCVID001', 'les_PGTAPCVID002')$$,
  '23505',
  NULL,
  'a message shares at most one lesson video'
);
SELECT matches((SELECT id FROM public.chat_message_videos WHERE message_id = 'msg_PGTAPCVID001'), '^cmv_[1-9A-HJ-NP-Za-km-z]{12}$', 'the id has the cmv_ prefix');
SELECT is(
  (SELECT enabled_globally FROM public.feature_flags WHERE feature_key = 'chat_videos'),
  false,
  'the chat_videos flag exists and is off for everyone'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ca01", "email": "cvideo-fern@example.test", "role": "authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.chat_message_videos WHERE message_id = 'msg_PGTAPCVID001'),
  1,
  'a member sees the video shared in a public channel'
);
SELECT is(
  (SELECT count(*)::int FROM public.chat_message_videos WHERE message_id = 'msg_PGTAPCVID002'),
  0,
  'a member who is not in a private channel does not see its shared video'
);
SELECT throws_ok(
  $$INSERT INTO public.chat_message_videos (message_id, lesson_id) VALUES ('msg_PGTAPCVID003', 'les_PGTAPCVID001')$$,
  '42501',
  NULL,
  'a member cannot write a shared video directly'
);

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT 1 FROM public.chat_message_videos$$, '42501', NULL, 'a signed-out visitor cannot read them');

RESET ROLE;
DELETE FROM public.chat_messages WHERE id = 'msg_PGTAPCVID001';
SELECT is(
  (SELECT count(*)::int FROM public.chat_message_videos WHERE message_id = 'msg_PGTAPCVID001'),
  0,
  'the row goes with its message'
);
DELETE FROM public.course_lessons WHERE id = 'les_PGTAPCVID001';
SELECT is(
  (SELECT count(*)::int FROM public.chat_message_videos WHERE lesson_id = 'les_PGTAPCVID001'),
  0,
  'and with its lesson'
);
SELECT is(
  (SELECT count(*)::int FROM public.chat_message_videos WHERE message_id = 'msg_PGTAPCVID003'),
  0,
  'a refused write left nothing behind'
);

SELECT * FROM finish(true);
ROLLBACK;
