-- pgTAP tests for 20270530000000_chat_post_shared_video.sql:
--  * the message and its video row are written together;
--  * a member can only share a lesson they could open themselves: no access, a lesson not open yet, a draft course,
--    a lesson without a video are all refused, and nothing is posted;
--  * only an admin can open a share to the channel, and an admin can share any lesson;
--  * a signed-out visitor cannot call it.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(13);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000cc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cshare-fern@example.test'),
  ('00000000-0000-4000-a000-00000000cc02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cshare-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000cc01', 'cshare-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000cc02', 'cshare-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_PGTAPCSHR001', 'Share Fern', 'cshare-fern@example.test', now(), 'active'),
  ('mbr_PGTAPCSHR002', 'Share Admin', 'cshare-admin@example.test', now(), 'active');
UPDATE public.members SET user_id = '00000000-0000-4000-a000-00000000cc01' WHERE id = 'mbr_PGTAPCSHR001';
UPDATE public.members SET user_id = '00000000-0000-4000-a000-00000000cc02' WHERE id = 'mbr_PGTAPCSHR002';
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id, bridge_mode) VALUES
  ('chn_PGTAPCSHR001', 'channel', 'private', false, 'cshare', 'PGTAP_CS_CHAN', 'bridged');
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES
  ('chn_PGTAPCSHR001', 'mbr_PGTAPCSHR001'), ('chn_PGTAPCSHR001', 'mbr_PGTAPCSHR002');

INSERT INTO public.videos (source_kind, source_key, status) VALUES ('upload', 'pgtap-cshare', 'ready');
INSERT INTO public.courses (id, slug, title, source_key, is_draft) VALUES
  ('crs_PGTAPCSHR001', 'pgtap-cshare', 'Shared course', 'pgtap-cshare', false),
  ('crs_PGTAPCSHR002', 'pgtap-cshare-draft', 'Draft course', 'pgtap-cshare-draft', true),
  ('crs_PGTAPCSHR003', 'pgtap-cshare-none', 'Course without access', 'pgtap-cshare-none', false);
-- Lessons: open with video; coming soon; in the draft course; in the course Fern has no access to; open without video.
INSERT INTO public.course_lessons (id, course_id, title, position, source_key, state, video_id) VALUES
  ('les_PGTAPCSHR001', 'crs_PGTAPCSHR001', 'Open', 1, 'pgtap-cshare-1', 'open', (SELECT id FROM public.videos WHERE source_key = 'pgtap-cshare')),
  ('les_PGTAPCSHR002', 'crs_PGTAPCSHR001', 'Soon', 2, 'pgtap-cshare-2', 'coming_soon', (SELECT id FROM public.videos WHERE source_key = 'pgtap-cshare')),
  ('les_PGTAPCSHR003', 'crs_PGTAPCSHR002', 'Draft', 1, 'pgtap-cshare-3', 'open', (SELECT id FROM public.videos WHERE source_key = 'pgtap-cshare')),
  ('les_PGTAPCSHR004', 'crs_PGTAPCSHR003', 'No access', 1, 'pgtap-cshare-4', 'open', (SELECT id FROM public.videos WHERE source_key = 'pgtap-cshare')),
  ('les_PGTAPCSHR005', 'crs_PGTAPCSHR001', 'No video', 3, 'pgtap-cshare-5', 'open', NULL);
INSERT INTO public.course_access (member_id, course_id, starts_at, ends_at, origin) VALUES
  ('mbr_PGTAPCSHR001', 'crs_PGTAPCSHR001', now() - interval '1 day', NULL, 'purchase'),
  ('mbr_PGTAPCSHR001', 'crs_PGTAPCSHR002', now() - interval '1 day', NULL, 'purchase');

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
CREATE FUNCTION public.pgtap_try_share(p_label text, p_lesson text, p_open boolean) RETURNS void AS $$
BEGIN
  INSERT INTO result VALUES (p_label, 'ok:' || chat_post_shared_video('chn_PGTAPCSHR001', 'look at this', p_lesson, p_open)::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (p_label, SQLERRM);
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.pgtap_try_share(text, text, boolean) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cc01", "email": "cshare-fern@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try_share('member shares', 'les_PGTAPCSHR001', false);
SELECT public.pgtap_try_share('member opens it', 'les_PGTAPCSHR001', true);
SELECT public.pgtap_try_share('not open yet', 'les_PGTAPCSHR002', false);
SELECT public.pgtap_try_share('draft course', 'les_PGTAPCSHR003', false);
SELECT public.pgtap_try_share('no access', 'les_PGTAPCSHR004', false);
SELECT public.pgtap_try_share('no video', 'les_PGTAPCSHR005', false);
SELECT public.pgtap_try_share('no such lesson', 'les_PGTAPCSHR999', false);

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cc02", "email": "cshare-admin@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try_share('admin opens it', 'les_PGTAPCSHR004', true);
SELECT public.pgtap_try_share('admin shares a coming soon lesson', 'les_PGTAPCSHR002', false);
RESET ROLE;

SELECT is(
  (SELECT (SELECT v.open_to_channel::text || '|' || v.lesson_id FROM chat_message_videos v WHERE v.message_id = substr(r.value, 4)) FROM result r WHERE r.label = 'member shares'),
  'false|les_PGTAPCSHR001',
  'a member shares a lesson they can open: the message and its video row are written together, closed to non-members of the course'
);
SELECT is((SELECT value FROM result WHERE label = 'member opens it'), 'chat_post: not_allowed', 'a member cannot open it to the channel');
SELECT is(
  (SELECT string_agg(value, ',' ORDER BY label) FROM result WHERE label IN ('not open yet', 'draft course', 'no access', 'no video', 'no such lesson')),
  'chat_post: bad_video,chat_post: bad_video,chat_post: bad_video,chat_post: bad_video,chat_post: bad_video',
  'a lesson that is not open yet, in a draft course, without access, without a video, or missing is refused'
);
SELECT is(
  (SELECT count(*)::int FROM chat_messages WHERE channel_id = 'chn_PGTAPCSHR001'),
  3,
  'a refused share posts nothing (the member''s one share and the admin''s two)'
);
SELECT is(
  (SELECT v.open_to_channel FROM chat_message_videos v WHERE v.message_id = (SELECT substr(value, 4) FROM result WHERE label = 'admin opens it')),
  true,
  'an admin can open a share to the channel, whatever access they have'
);
SELECT ok((SELECT value LIKE 'ok:%' FROM result WHERE label = 'admin shares a coming soon lesson'), 'an admin can share a lesson members cannot open yet');
SELECT is(
  (SELECT count(*)::int FROM chat_message_videos v JOIN chat_messages m ON m.id = v.message_id WHERE m.channel_id = 'chn_PGTAPCSHR001'),
  3,
  'every message in the channel has its video row'
);

-- Checked as a privilege, not by calling it as anon: calling a refused SECURITY DEFINER function under SET ROLE anon crashed an older local Postgres.
SELECT is(has_function_privilege('anon', 'public.chat_post_shared_video(text,text,text,boolean)', 'EXECUTE'), false, 'a signed-out visitor cannot call it');
SELECT is(has_function_privilege('authenticated', 'public.chat_post_shared_video(text,text,text,boolean)', 'EXECUTE'), true, 'a signed-in member can');

SELECT is(
  (SELECT open_to_channel FROM chat_message_videos WHERE message_id = (SELECT substr(value, 4) FROM result WHERE label = 'member shares')),
  false,
  'the column defaults to closed'
);
SELECT col_default_is('public', 'chat_message_videos', 'open_to_channel', 'false', 'and is closed unless asked');
SELECT has_function('public', 'chat_post_shared_video', ARRAY['text', 'text', 'text', 'boolean'], 'the function exists');
SELECT function_privs_are('public', 'chat_post_shared_video', ARRAY['text', 'text', 'text', 'boolean'], 'anon', ARRAY[]::text[], 'and anon has no privilege on it');

SELECT * FROM finish(true);
ROLLBACK;
