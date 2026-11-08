-- pgTAP tests for 20270529000000_watch_segments_chat_message.sql:
--  * a member can save a stretch tagged with a chat message, as themselves;
--  * the column is optional (a lesson-page stretch has none);
--  * a tag must name a message that exists;
--  * deleting the message keeps the stretch and clears the tag.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000cb01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cwatch-fern@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000cb01', 'cwatch-fern@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_PGTAPCWAT001', 'Watch Fern', 'cwatch-fern@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('chn_PGTAPCWAT001', 'channel', 'public', false, 'cwatch', 'PGTAP_CW_CHAN');
INSERT INTO public.chat_messages (id, channel_id, author_member_id, created_at, origin, slack_sync_status) VALUES
  ('msg_PGTAPCWAT001', 'chn_PGTAPCWAT001', 'mbr_PGTAPCWAT001', now(), 'app', 'sent');
INSERT INTO public.videos (source_kind, source_key, status) VALUES ('upload', 'pgtap-cwatch', 'ready');
-- A member can't read videos, so the statements below take the id from a setting made before the role changes.
SELECT set_config('pgtap.video', (SELECT id::text FROM public.videos WHERE source_key = 'pgtap-cwatch'), true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cb01", "email": "cwatch-fern@example.test", "role": "authenticated"}', true);

SELECT lives_ok(
  format($f$INSERT INTO public.video_watch_segments (member_id, video_id, session_id, start_seconds, end_seconds, chat_message_id)
    VALUES ('mbr_PGTAPCWAT001', %L, '10000000-0000-4000-a000-00000000cb01', 0, 30, 'msg_PGTAPCWAT001')$f$, current_setting('pgtap.video')),
  'a member saves a stretch watched from a chat message'
);
SELECT lives_ok(
  format($f$INSERT INTO public.video_watch_segments (member_id, video_id, session_id, start_seconds, end_seconds)
    VALUES ('mbr_PGTAPCWAT001', %L, '10000000-0000-4000-a000-00000000cb02', 0, 30)$f$, current_setting('pgtap.video')),
  'and one with no message, as a lesson-page view'
);

RESET ROLE;
SELECT throws_ok(
  format($f$INSERT INTO public.video_watch_segments (member_id, video_id, session_id, start_seconds, end_seconds, chat_message_id)
    VALUES ('mbr_PGTAPCWAT001', %L, '10000000-0000-4000-a000-00000000cb03', 0, 30, 'msg_PGTAPCWAT999')$f$, current_setting('pgtap.video')),
  '23503',
  NULL,
  'a tag has to name a message that exists'
);

DELETE FROM public.chat_messages WHERE id = 'msg_PGTAPCWAT001';
SELECT is(
  (SELECT count(*)::int FROM public.video_watch_segments WHERE video_id::text = current_setting('pgtap.video')),
  2,
  'deleting the message keeps the stretches'
);
SELECT is(
  (SELECT count(*)::int FROM public.video_watch_segments WHERE video_id::text = current_setting('pgtap.video') AND chat_message_id IS NOT NULL),
  0,
  'and clears the tag'
);

SELECT * FROM finish(true);
ROLLBACK;
