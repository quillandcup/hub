-- pgTAP tests for 20261018000000_chat_posting.sql: chat_post_message only lets a member post as
-- themselves into a bridged, open conversation they are in (and into a thread whose root is in
-- Slack), members have no way to write chat_messages directly, the outbox's service-role steps
-- fold a duplicate projection into the app row, and Slack's event for our own post (identified by
-- its metadata) is linked to that row instead of becoming a second one.
-- Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(19);

SELECT ok(NOT has_function_privilege('anon', 'chat_post_message(uuid, text, uuid)', 'EXECUTE'), 'anon cannot post');
SELECT ok(has_function_privilege('authenticated', 'chat_post_message(uuid, text, uuid)', 'EXECUTE'), 'authenticated can post');
SELECT ok(
  NOT has_function_privilege('authenticated', 'chat_mark_message_sent(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'chat_mark_message_failed(uuid)', 'EXECUTE'),
  'only the service role runs the outbox steps'
);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'post-fern@example.test'),
  ('00000000-0000-4000-a000-00000000f7a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'post-gale@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', 'post-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f7a2', 'post-gale@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f701', 'Post Fern', 'post-fern@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f702', 'Post Gale', 'post-gale@example.test', now(), 'active');

-- c1 live and bridged; c2 archived; c3 not mirrored; c4 app-only. Fern is in all of them, Gale in none.
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id, archived_at, bridge_disabled, bridge_mode) VALUES
  ('00000000-0000-4000-a000-00000000f7c1', 'channel', 'private', false, 'post-live', 'PGTAP_P_LIVE', NULL, false, 'bridged'),
  ('00000000-0000-4000-a000-00000000f7c2', 'channel', 'private', false, 'post-old', 'PGTAP_P_OLD', now(), false, 'bridged'),
  ('00000000-0000-4000-a000-00000000f7c3', 'channel', 'private', false, 'post-off', 'PGTAP_P_OFF', NULL, true, 'bridged'),
  ('00000000-0000-4000-a000-00000000f7c4', 'channel', 'private', false, 'post-app', NULL, NULL, false, 'app_only');
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES
  ('00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f701'),
  ('00000000-0000-4000-a000-00000000f7c2', '00000000-0000-4000-a000-00000000f701'),
  ('00000000-0000-4000-a000-00000000f7c3', '00000000-0000-4000-a000-00000000f701'),
  ('00000000-0000-4000-a000-00000000f7c4', '00000000-0000-4000-a000-00000000f701');

-- A root that is in Slack, a root that is not (still sending), and a reply (a thread is one level deep).
INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, slack_ts, created_at, origin, slack_sync_status) VALUES
  ('00000000-0000-4000-a000-00000000f7d1', '00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f702', NULL, '7.1', '2020-01-01', 'slack', NULL),
  ('00000000-0000-4000-a000-00000000f7d2', '00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f701', NULL, NULL, '2020-01-02', 'app', 'pending'),
  ('00000000-0000-4000-a000-00000000f7d3', '00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f702', '00000000-0000-4000-a000-00000000f7d1', '7.2', '2020-01-03', 'slack', NULL);

-- Tries a post as the current role and records the new id's row state, or the error, under a label.
CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
CREATE FUNCTION public.pgtap_try_post(p_label text, p_channel uuid, p_body text, p_root uuid DEFAULT NULL) RETURNS void AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := chat_post_message(p_channel, p_body, p_root);
  INSERT INTO result VALUES (p_label, 'ok:' || v_id::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (p_label, SQLERRM);
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.pgtap_try_post(text, uuid, text, uuid) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "post-fern@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try_post('ok', '00000000-0000-4000-a000-00000000f7c1', E'  Hello from the Hub \n');
SELECT public.pgtap_try_post('reply', '00000000-0000-4000-a000-00000000f7c1', 'A reply', '00000000-0000-4000-a000-00000000f7d1');
SELECT public.pgtap_try_post('empty', '00000000-0000-4000-a000-00000000f7c1', '   ');
SELECT public.pgtap_try_post('long', '00000000-0000-4000-a000-00000000f7c1', repeat('x', 4001));
SELECT public.pgtap_try_post('archived', '00000000-0000-4000-a000-00000000f7c2', 'hi');
SELECT public.pgtap_try_post('disabled', '00000000-0000-4000-a000-00000000f7c3', 'hi');
SELECT public.pgtap_try_post('app only', '00000000-0000-4000-a000-00000000f7c4', 'hi');
SELECT public.pgtap_try_post('unsent root', '00000000-0000-4000-a000-00000000f7c1', 'hi', '00000000-0000-4000-a000-00000000f7d2');
SELECT public.pgtap_try_post('reply to reply', '00000000-0000-4000-a000-00000000f7c1', 'hi', '00000000-0000-4000-a000-00000000f7d3');
DO $$
BEGIN
  INSERT INTO chat_messages (channel_id, author_member_id, origin, created_at)
  VALUES ('00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f701', 'app', now());
  INSERT INTO result VALUES ('direct insert', 'inserted');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES ('direct insert', 'refused');
END $$;

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a2", "email": "post-gale@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try_post('outsider', '00000000-0000-4000-a000-00000000f7c1', 'hi');
RESET ROLE;

SELECT matches((SELECT value FROM result WHERE label = 'ok'), '^ok:', 'a member posts into a conversation they are in');
SELECT is(
  (SELECT concat_ws('|', m.origin, m.slack_sync_status, m.posted_via, m.slack_ts IS NULL, m.author_member_id::text, c.body)
   FROM chat_messages m JOIN chat_message_contents c ON c.message_id = m.id
   WHERE m.id = substr((SELECT value FROM result WHERE label = 'ok'), 4)::uuid),
  'app|pending|bot|t|00000000-0000-4000-a000-00000000f701|Hello from the Hub',
  'the message is the caller''s, pending, with no Slack ts yet, and its body is trimmed'
);
SELECT is(
  (SELECT concat_ws('|', reply_count, thread_root_id::text) FROM chat_messages WHERE id = substr((SELECT value FROM result WHERE label = 'reply'), 4)::uuid),
  '0|00000000-0000-4000-a000-00000000f7d1',
  'a reply points at its root'
);
SELECT is((SELECT reply_count FROM chat_messages WHERE id = '00000000-0000-4000-a000-00000000f7d1'), 1, 'and counts toward the root''s replies');
SELECT is((SELECT value FROM result WHERE label = 'empty'), 'chat_post: empty', 'a blank message is refused');
SELECT is((SELECT value FROM result WHERE label = 'long'), 'chat_post: too_long', 'so is one over 4000 characters');
SELECT is((SELECT value FROM result WHERE label = 'archived'), 'chat_post: archived', 'an archived conversation takes no posts');
SELECT is(
  (SELECT string_agg(value, ',' ORDER BY label) FROM result WHERE label IN ('disabled', 'app only')),
  'chat_post: not_bridged,chat_post: not_bridged',
  'a conversation that is not mirrored, or not on Slack, is refused'
);
SELECT is(
  (SELECT string_agg(value, ',' ORDER BY label) FROM result WHERE label IN ('unsent root', 'reply to reply')),
  'chat_post: bad_thread,chat_post: bad_thread',
  'a thread needs a root that is in Slack, and is one level deep'
);
SELECT is((SELECT value FROM result WHERE label = 'outsider'), 'chat_post: not_in_channel', 'someone not in the conversation cannot post');
SELECT is((SELECT value FROM result WHERE label = 'direct insert'), 'refused', 'members have no way to write chat_messages directly');

-- Marking sent folds a copy the projection already made under the same ts into the app row.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, slack_ts, created_at, origin, slack_sync_status) VALUES
  ('00000000-0000-4000-a000-00000000f7d4', '00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f701', NULL, now(), 'app', 'pending'),
  ('00000000-0000-4000-a000-00000000f7d5', '00000000-0000-4000-a000-00000000f7c1', NULL, '7.9', now(), 'slack', NULL);
INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, slack_ts, created_at, origin) VALUES
  ('00000000-0000-4000-a000-00000000f7d6', '00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f702', '00000000-0000-4000-a000-00000000f7d5', '7.10', now(), 'slack');
UPDATE public.chat_messages SET reply_count = 1 WHERE id = '00000000-0000-4000-a000-00000000f7d5';
SELECT chat_mark_message_sent('00000000-0000-4000-a000-00000000f7d4', '7.9');
SELECT is(
  (SELECT concat_ws('|', slack_sync_status, slack_ts, reply_count) FROM chat_messages WHERE id = '00000000-0000-4000-a000-00000000f7d4'),
  'sent|7.9|1',
  'marking sent stores the ts and takes over the copy''s replies'
);
SELECT is(
  (SELECT concat_ws('|', (SELECT count(*) FROM chat_messages WHERE id = '00000000-0000-4000-a000-00000000f7d5'), (SELECT thread_root_id::text FROM chat_messages WHERE id = '00000000-0000-4000-a000-00000000f7d6'))),
  '0|00000000-0000-4000-a000-00000000f7d4',
  'the copy is gone and its replies point at the app row'
);

-- Marking failed only touches a pending message.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, slack_ts, created_at, origin, slack_sync_status) VALUES
  ('00000000-0000-4000-a000-00000000f7d7', '00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f701', '7.11', now(), 'app', 'sent');
SELECT chat_mark_message_failed('00000000-0000-4000-a000-00000000f7d7');
SELECT chat_mark_message_failed('00000000-0000-4000-a000-00000000f7d2');
SELECT is(
  (SELECT string_agg(slack_sync_status, ',' ORDER BY id) FROM chat_messages WHERE id IN ('00000000-0000-4000-a000-00000000f7d2', '00000000-0000-4000-a000-00000000f7d7')),
  'failed,sent',
  'marking failed leaves a sent message alone'
);

-- Slack's event for our own post (it carries our id in its metadata) is linked, not duplicated.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, slack_ts, created_at, origin, slack_sync_status) VALUES
  ('00000000-0000-4000-a000-00000000f7d8', '00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f701', NULL, now(), 'app', 'pending');
INSERT INTO bronze.slack_messages (channel_id, message_ts, user_id, text, message_type, occurred_at, raw_payload) VALUES
  ('PGTAP_P_LIVE', '7.12', 'B_BOT', 'posted from the hub', 'message', now(),
   '{"metadata": {"event_type": "hub_message", "event_payload": {"app_message_id": "00000000-0000-4000-a000-00000000f7d8"}}}'::jsonb);
SELECT is(
  (SELECT concat_ws('|', slack_ts, slack_sync_status) FROM chat_messages WHERE id = '00000000-0000-4000-a000-00000000f7d8'),
  '7.12|sent',
  'the event for our own post is linked to the app row'
);
SELECT is(
  (SELECT count(*) FROM chat_messages WHERE channel_id = '00000000-0000-4000-a000-00000000f7c1' AND slack_ts = '7.12'),
  1::bigint,
  'and the projection then has one message to update, not two'
);

SELECT * FROM finish(true);
ROLLBACK;
