-- pgTAP tests for 20270531000000_chat_post_shared_video_thread.sql:
--  * a lesson video can be shared as a reply in a thread, and in a Hub direct message;
--  * a bad thread refuses the share and leaves neither a message nor a video row;
--  * the four-argument form (dropped by 20270604000000) is gone;
--  * the same sharer checks apply (no access, not in the conversation).
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(12);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000cd01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cthread-fern@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000cd01', 'cthread-fern@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_PGTAPCTHR001', 'Thread Fern', 'cthread-fern@example.test', now(), 'active', '00000000-0000-4000-a000-00000000cd01'),
  ('mbr_PGTAPCTHR002', 'Thread Bo', 'cthread-bo@example.test', now(), 'active', NULL);

INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id, bridge_mode) VALUES
  ('chn_PGTAPCTHR001', 'channel', 'private', false, 'cthread', 'PGTAP_CT_CHAN', 'bridged'),
  ('chn_PGTAPCTHR002', 'channel', 'private', false, 'cthread-out', 'PGTAP_CT_OUT', 'bridged');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, bridge_mode, dm_key) VALUES
  ('chn_PGTAPCTHR003', 'dm', 'private', true, 'app_only', 'mbr_PGTAPCTHR001:mbr_PGTAPCTHR002');
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES
  ('chn_PGTAPCTHR001', 'mbr_PGTAPCTHR001'), ('chn_PGTAPCTHR003', 'mbr_PGTAPCTHR001'), ('chn_PGTAPCTHR003', 'mbr_PGTAPCTHR002');

-- A thread root Slack has (a bridged channel needs a slack_ts), and a reply, which can't be a thread root.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, slack_ts, created_at, origin, slack_sync_status) VALUES
  ('msg_PGTAPCTHR001', 'chn_PGTAPCTHR001', 'mbr_PGTAPCTHR002', '4070908900.000200', now(), 'slack', NULL);
INSERT INTO public.chat_message_contents (message_id, body) VALUES ('msg_PGTAPCTHR001', 'a root');
INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, slack_ts, created_at, origin) VALUES
  ('msg_PGTAPCTHR002', 'chn_PGTAPCTHR001', 'mbr_PGTAPCTHR002', 'msg_PGTAPCTHR001', '4070908900.000300', now(), 'slack');
INSERT INTO public.chat_message_contents (message_id, body) VALUES ('msg_PGTAPCTHR002', 'a reply');

INSERT INTO public.videos (source_kind, source_key, status) VALUES ('upload', 'pgtap-cthread', 'ready');
INSERT INTO public.courses (id, slug, title, source_key, is_draft) VALUES
  ('crs_PGTAPCTHR001', 'pgtap-cthread', 'Thread course', 'pgtap-cthread', false),
  ('crs_PGTAPCTHR002', 'pgtap-cthread-no', 'No access course', 'pgtap-cthread-no', false);
INSERT INTO public.course_lessons (id, course_id, title, position, source_key, state, video_id) VALUES
  ('les_PGTAPCTHR001', 'crs_PGTAPCTHR001', 'Open', 1, 'pgtap-cthread-1', 'open', (SELECT id FROM public.videos WHERE source_key = 'pgtap-cthread')),
  ('les_PGTAPCTHR002', 'crs_PGTAPCTHR002', 'No access', 1, 'pgtap-cthread-2', 'open', (SELECT id FROM public.videos WHERE source_key = 'pgtap-cthread'));
INSERT INTO public.course_access (member_id, course_id, starts_at, ends_at, origin) VALUES
  ('mbr_PGTAPCTHR001', 'crs_PGTAPCTHR001', now() - interval '1 day', NULL, 'purchase');

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
CREATE FUNCTION public.pgtap_try_share5(p_label text, p_channel text, p_lesson text, p_thread text) RETURNS void AS $$
BEGIN
  INSERT INTO result VALUES (p_label, 'ok:' || chat_post_shared_video(p_channel, 'look', p_lesson, false, p_thread)::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (p_label, SQLERRM);
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.pgtap_try_share5(text, text, text, text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cd01", "email": "cthread-fern@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try_share5('thread reply', 'chn_PGTAPCTHR001', 'les_PGTAPCTHR001', 'msg_PGTAPCTHR001');
SELECT public.pgtap_try_share5('reply to a reply', 'chn_PGTAPCTHR001', 'les_PGTAPCTHR001', 'msg_PGTAPCTHR002');
SELECT public.pgtap_try_share5('no such root', 'chn_PGTAPCTHR001', 'les_PGTAPCTHR001', 'msg_PGTAPCTHR999');
SELECT public.pgtap_try_share5('direct message', 'chn_PGTAPCTHR003', 'les_PGTAPCTHR001', NULL);
SELECT public.pgtap_try_share5('no access, in a thread', 'chn_PGTAPCTHR001', 'les_PGTAPCTHR002', 'msg_PGTAPCTHR001');
SELECT public.pgtap_try_share5('not in the conversation', 'chn_PGTAPCTHR002', 'les_PGTAPCTHR001', NULL);
SELECT public.pgtap_try_share5('top level', 'chn_PGTAPCTHR001', 'les_PGTAPCTHR001', NULL);
RESET ROLE;

SELECT is(
  (SELECT m.thread_root_id || '|' || (SELECT v.lesson_id FROM chat_message_videos v WHERE v.message_id = m.id)
   FROM chat_messages m WHERE m.id = (SELECT substr(value, 4) FROM result WHERE label = 'thread reply')),
  'msg_PGTAPCTHR001|les_PGTAPCTHR001',
  'a share goes into a thread as a reply, with its video row'
);
SELECT is((SELECT reply_count FROM chat_messages WHERE id = 'msg_PGTAPCTHR001'), 1, 'and counts as a reply to the root');
SELECT is(
  (SELECT string_agg(value, ',' ORDER BY label) FROM result WHERE label IN ('reply to a reply', 'no such root')),
  'chat_post: bad_thread,chat_post: bad_thread',
  'a reply to a reply, or to a message that is not there, is refused'
);
SELECT is(
  (SELECT value FROM result WHERE label = 'no access, in a thread'),
  'chat_post: bad_video',
  'the sharer checks apply in a thread too'
);
SELECT is((SELECT value FROM result WHERE label = 'not in the conversation'), 'chat_post: not_in_channel', 'and being in the conversation');
SELECT is(
  (SELECT count(*)::int FROM chat_messages WHERE author_member_id = 'mbr_PGTAPCTHR001'),
  3,
  'refused shares left no message behind (the thread reply, the direct message and the top-level one)'
);
SELECT is(
  (SELECT count(*)::int FROM chat_message_videos v JOIN chat_messages m ON m.id = v.message_id WHERE m.author_member_id = 'mbr_PGTAPCTHR001'),
  3,
  'and every message that was posted has its video row'
);
SELECT is(
  (SELECT m.slack_sync_status IS NULL FROM chat_messages m WHERE m.id = (SELECT substr(value, 4) FROM result WHERE label = 'direct message')),
  true,
  'a share in a direct message is Hub-only: nothing is queued for Slack'
);
SELECT ok((SELECT value LIKE 'ok:%' FROM result WHERE label = 'top level'), 'a top-level share passes a null thread root');
SELECT hasnt_function('public', 'chat_post_shared_video', ARRAY['text', 'text', 'text', 'boolean'], 'and the old four-argument form is gone');
SELECT is(has_function_privilege('anon', 'public.chat_post_shared_video(text,text,text,boolean,text)', 'EXECUTE'), false, 'a signed-out visitor cannot call the new form');
SELECT is(has_function_privilege('authenticated', 'public.chat_post_shared_video(text,text,text,boolean,text)', 'EXECUTE'), true, 'a signed-in member can');

SELECT * FROM finish(true);
ROLLBACK;
