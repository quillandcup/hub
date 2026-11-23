-- pgTAP tests for 20270727000000_chat_message_videos_start_seconds.sql:
--  * a share can carry the second its pasted link started at, stored on its video row;
--  * a start outside 1..86400 is dropped (the video is still shared), and the table refuses one written directly;
--  * the five-argument form still works and stores no start;
--  * the new form is callable by members and not by signed-out visitors.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000ce01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cstart-fern@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000ce01', 'cstart-fern@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_PGTAPCSTR001', 'Start Fern', 'cstart-fern@example.test', now(), 'active', '00000000-0000-4000-a000-00000000ce01');

INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id, bridge_mode) VALUES
  ('chn_PGTAPCSTR001', 'channel', 'private', false, 'cstart', 'PGTAP_CS_CHAN', 'bridged');
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES ('chn_PGTAPCSTR001', 'mbr_PGTAPCSTR001');

INSERT INTO public.videos (source_kind, source_key, status) VALUES ('upload', 'pgtap-cstart', 'ready');
INSERT INTO public.courses (id, slug, title, source_key, is_draft) VALUES
  ('crs_PGTAPCSTR001', 'pgtap-cstart', 'Start course', 'pgtap-cstart', false);
INSERT INTO public.course_lessons (id, course_id, title, position, source_key, state, video_id) VALUES
  ('les_PGTAPCSTR001', 'crs_PGTAPCSTR001', 'Open', 1, 'pgtap-cstart-1', 'open', (SELECT id FROM public.videos WHERE source_key = 'pgtap-cstart'));
INSERT INTO public.course_access (member_id, course_id, starts_at, ends_at, origin) VALUES
  ('mbr_PGTAPCSTR001', 'crs_PGTAPCSTR001', now() - interval '1 day', NULL, 'purchase');

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
CREATE FUNCTION public.pgtap_try_start(p_label text, p_start integer) RETURNS void AS $$
BEGIN
  INSERT INTO result VALUES (p_label, chat_post_shared_video('chn_PGTAPCSTR001', 'look', 'les_PGTAPCSTR001', false, NULL::text, p_start)::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (p_label, SQLERRM);
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.pgtap_try_start(text, integer) TO authenticated;
CREATE FUNCTION public.pgtap_try_five(p_label text) RETURNS void AS $$
BEGIN
  INSERT INTO result VALUES (p_label, chat_post_shared_video('chn_PGTAPCSTR001', 'look', 'les_PGTAPCSTR001', false, NULL::text)::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (p_label, SQLERRM);
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.pgtap_try_five(text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ce01", "email": "cstart-fern@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try_start('with a start', 95);
SELECT public.pgtap_try_start('no start', NULL);
SELECT public.pgtap_try_start('zero', 0);
SELECT public.pgtap_try_start('negative', -5);
SELECT public.pgtap_try_start('more than a day', 86401);
SELECT public.pgtap_try_five('five arguments');
RESET ROLE;

CREATE FUNCTION public.pgtap_start_of(p_label text) RETURNS integer AS $$
  SELECT v.start_seconds FROM public.chat_message_videos v WHERE v.message_id = (SELECT value FROM result WHERE label = p_label)
$$ LANGUAGE sql;

SELECT is(public.pgtap_start_of('with a start'), 95, 'a share stores the second its link started at');
SELECT is(public.pgtap_start_of('no start'), NULL, 'a share without one stores none');
SELECT ok((SELECT value LIKE 'msg_%' FROM result WHERE label = 'zero') AND public.pgtap_start_of('zero') IS NULL, 'a start of zero still shares the video, from no start');
SELECT ok((SELECT value LIKE 'msg_%' FROM result WHERE label = 'negative') AND public.pgtap_start_of('negative') IS NULL, 'a negative start is dropped, not an error');
SELECT ok((SELECT value LIKE 'msg_%' FROM result WHERE label = 'more than a day') AND public.pgtap_start_of('more than a day') IS NULL, 'so is one over a day');
SELECT ok((SELECT value LIKE 'msg_%' FROM result WHERE label = 'five arguments') AND public.pgtap_start_of('five arguments') IS NULL, 'the five-argument form still shares, with no start');
SELECT throws_ok(
  $$UPDATE public.chat_message_videos SET start_seconds = 0 WHERE lesson_id = 'les_PGTAPCSTR001'$$,
  '23514',
  NULL,
  'the table itself refuses a start outside 1..86400'
);
SELECT is(has_function_privilege('anon', 'public.chat_post_shared_video(text,text,text,boolean,text,integer)', 'EXECUTE'), false, 'a signed-out visitor cannot call the new form');
SELECT is(has_function_privilege('authenticated', 'public.chat_post_shared_video(text,text,text,boolean,text,integer)', 'EXECUTE'), true, 'a signed-in member can');

SELECT * FROM finish(true);
ROLLBACK;
