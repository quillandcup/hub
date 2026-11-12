-- pgTAP tests for 20270627000000_chat_message_videos_hide_deleted.sql: a deleted message shares no video with anyone who reads
-- the channel (not the member who shared it either), and a live one still does. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(4);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000cb01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cvdel-fern@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000cb01', 'cvdel-fern@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_PGTAPCVDL001', 'Video Fern', 'cvdel-fern@example.test', now(), 'active');

INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('chn_PGTAPCVDL001', 'channel', 'public', false, 'cvdel-open', 'PGTAP_CVDL_OPEN');
INSERT INTO public.chat_messages (id, channel_id, author_member_id, created_at, origin, slack_sync_status) VALUES
  ('msg_PGTAPCVDL001', 'chn_PGTAPCVDL001', 'mbr_PGTAPCVDL001', now(), 'app', 'sent'),
  ('msg_PGTAPCVDL002', 'chn_PGTAPCVDL001', 'mbr_PGTAPCVDL001', now(), 'app', 'sent');
INSERT INTO public.chat_message_contents (message_id, body) VALUES
  ('msg_PGTAPCVDL001', 'live'), ('msg_PGTAPCVDL002', 'to be deleted');

INSERT INTO public.courses (id, slug, title, source_key) VALUES ('crs_PGTAPCVDL001', 'pgtap-cvdel', 'Video course', 'pgtap-cvdel');
INSERT INTO public.course_lessons (id, course_id, title, position, source_key) VALUES
  ('les_PGTAPCVDL001', 'crs_PGTAPCVDL001', 'Lesson one', 1, 'pgtap-cvdel-1');
INSERT INTO public.chat_message_videos (message_id, lesson_id, open_to_channel) VALUES
  ('msg_PGTAPCVDL001', 'les_PGTAPCVDL001', true),
  ('msg_PGTAPCVDL002', 'les_PGTAPCVDL001', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cb01", "email": "cvdel-fern@example.test", "role": "authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.chat_message_videos WHERE message_id IN ('msg_PGTAPCVDL001', 'msg_PGTAPCVDL002')),
  2,
  'a member sees the open-to-channel shares of live messages'
);

RESET ROLE;
UPDATE public.chat_messages SET deleted_at = now() WHERE id = 'msg_PGTAPCVDL002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cb01", "email": "cvdel-fern@example.test", "role": "authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.chat_message_videos WHERE message_id = 'msg_PGTAPCVDL002'),
  0,
  'after the delete, the share is gone for a member who reads the channel (the author included)'
);
SELECT is(
  (SELECT count(*)::int FROM public.chat_message_videos WHERE message_id = 'msg_PGTAPCVDL001'),
  1,
  'a live message in the same channel still shares its video'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.chat_message_videos WHERE message_id = 'msg_PGTAPCVDL002'),
  1,
  'the row itself stays (a soft delete), only the read is closed'
);

SELECT * FROM finish(true);
ROLLBACK;
