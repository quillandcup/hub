-- pgTAP tests for 20261010000000_chat_mirror.sql: the Slack → chat projection (channels, membership,
-- messages, threads, reactions, soft deletes, re-runs) and the access rules for the chat_* tables.
-- Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(45);

-- Grants: API roles can at most read; only the service role writes or projects.
SELECT ok(NOT has_table_privilege('anon', 'public.chat_messages', 'SELECT'), 'anon cannot read chat_messages');
SELECT ok(NOT has_table_privilege('authenticated', 'public.chat_messages', 'INSERT'), 'authenticated cannot write chat_messages');
SELECT ok(NOT has_table_privilege('authenticated', 'public.chat_message_contents', 'UPDATE'), 'authenticated cannot write chat_message_contents');
SELECT ok(NOT has_table_privilege('authenticated', 'public.chat_channels', 'DELETE'), 'authenticated cannot write chat_channels');
SELECT ok(
  NOT has_function_privilege('authenticated', 'project_slack_chat_messages(timestamptz, timestamptz, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'project_slack_chat_channels(jsonb)', 'EXECUTE'),
  'authenticated cannot run the projection (it reads message content)'
);

-- Fern is in the private channels and the group DM; Gale is a member in none of them; Bramble is an admin.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-fern@example.test'),
  ('00000000-0000-4000-a000-00000000f1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-gale@example.test'),
  ('00000000-0000-4000-a000-00000000f1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-bramble@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', 'chat-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a2', 'chat-gale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a4', 'chat-bramble@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f101', 'Chat Fern', 'chat-fern@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f102', 'Chat Gale', 'chat-gale@example.test', now(), 'active');

INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, topic, purpose, raw_payload) VALUES
  ('PGTAP_CH_PUB', 'pgtap-public', false, false, 'Hello', '', '{}'),
  ('PGTAP_CH_PRIV', 'pgtap-private', true, false, '', '', '{}'),
  ('PGTAP_CH_QUIET', 'pgtap-quiet', true, false, '', '', '{}'),
  ('PGTAP_CH_MPIM', 'mpdm-fern--gale-1', true, true, '', '', '{}');
INSERT INTO bronze.slack_channel_members (channel_id, user_id) VALUES
  ('PGTAP_CH_PRIV', 'PGTAP_CU_FERN'), ('PGTAP_CH_QUIET', 'PGTAP_CU_FERN'), ('PGTAP_CH_MPIM', 'PGTAP_CU_FERN'),
  ('PGTAP_CH_PUB', 'PGTAP_CU_FERN'), ('PGTAP_CH_PUB', 'PGTAP_CU_GALE');
INSERT INTO bronze.slack_channel_members (channel_id, user_id, left_at) VALUES
  ('PGTAP_CH_PRIV', 'PGTAP_CU_GALE', '2099-01-01T00:00:00Z');
INSERT INTO public.restricted_slack_channels (channel_id, name) VALUES ('PGTAP_CH_QUIET', 'pgtap-quiet');

-- 2099 keeps the window clear of real rows. PGTAP_CU_BOT has no member.
INSERT INTO bronze.slack_messages (message_ts, channel_id, channel_name, channel_type, user_id, text, thread_ts, occurred_at, files, raw_payload) VALUES
  ('4070908800.000100', 'PGTAP_CH_PUB', 'pgtap-public', 'public_channel', 'PGTAP_CU_FERN', 'hello everyone', NULL, '2099-01-01T00:00:00Z', NULL, '{"blocks": [{"type": "rich_text"}]}'),
  ('4070908801.000100', 'PGTAP_CH_PUB', 'pgtap-public', 'public_channel', 'PGTAP_CU_GALE', 'a reply', '4070908800.000100', '2099-01-01T00:00:01Z', NULL, '{}'),
  ('4070908802.000100', 'PGTAP_CH_PUB', 'pgtap-public', 'public_channel', 'PGTAP_CU_BOT', 'a bot post', NULL, '2099-01-01T00:00:02Z', '[{"id": "F1"}]', '{}'),
  ('4070908803.000100', 'PGTAP_CH_PRIV', 'pgtap-private', 'private_channel', 'PGTAP_CU_FERN', 'private hello', NULL, '2099-01-01T00:00:03Z', NULL, '{}'),
  ('4070908804.000100', 'PGTAP_CH_QUIET', 'pgtap-quiet', 'private_channel', 'PGTAP_CU_FERN', 'quiet hello', NULL, '2099-01-01T00:00:04Z', NULL, '{}'),
  ('4070908805.000100', 'PGTAP_CH_MPIM', NULL, 'mpim', 'PGTAP_CU_FERN', 'dm hello', NULL, '2099-01-01T00:00:05Z', NULL, '{}');
INSERT INTO bronze.slack_messages (message_ts, channel_id, channel_name, channel_type, user_id, text, occurred_at, deleted_at, raw_payload) VALUES
  ('4070908806.000100', 'PGTAP_CH_PUB', 'pgtap-public', 'public_channel', 'PGTAP_CU_FERN', 'oops, deleted', '2099-01-01T00:00:06Z', '2099-01-01T00:05:00Z', '{}');
INSERT INTO bronze.slack_reactions (message_ts, channel_id, reaction, user_id, occurred_at, raw_payload) VALUES
  ('4070908800.000100', 'PGTAP_CH_PUB', 'tada', 'PGTAP_CU_GALE', '2099-01-01T00:00:00Z', '{}'),
  ('4070908800.000100', 'PGTAP_CH_PUB', 'eyes', 'PGTAP_CU_NOBODY', '2099-01-01T00:00:00Z', '{}');
INSERT INTO bronze.slack_reactions (message_ts, channel_id, reaction, user_id, occurred_at, deleted_at, raw_payload) VALUES
  ('4070908800.000100', 'PGTAP_CH_PUB', 'wave', 'PGTAP_CU_FERN', '2099-01-01T00:00:00Z', '2099-01-01T00:06:00Z', '{}');

CREATE TEMP TABLE map(m jsonb) ON COMMIT DROP;
INSERT INTO map VALUES ('{"PGTAP_CU_FERN": "00000000-0000-4000-a000-00000000f101", "PGTAP_CU_GALE": "00000000-0000-4000-a000-00000000f102"}');

SELECT project_slack_chat_channels((SELECT m FROM map));
SELECT project_slack_chat_messages('2099-01-01T00:00:00Z', '2099-01-01T00:10:00Z', (SELECT m FROM map));

-- Projection
SELECT is(
  (SELECT string_agg(slack_channel_id || ':' || kind || ':' || visibility || ':' || restricted::text, ', ' ORDER BY slack_channel_id)
     FROM chat_channels WHERE slack_channel_id LIKE 'PGTAP_CH_%'),
  'PGTAP_CH_MPIM:group_dm:private:true, PGTAP_CH_PRIV:channel:private:false, PGTAP_CH_PUB:channel:public:false, PGTAP_CH_QUIET:channel:private:true',
  'channels get kind, visibility and restricted (group DMs and restricted_slack_channels are restricted)'
);
SELECT is(
  (SELECT name FROM chat_channels WHERE slack_channel_id = 'PGTAP_CH_MPIM'), NULL,
  'a group DM''s name (a list of its members) is not kept'
);
SELECT is(
  (SELECT topic || '|' || COALESCE(purpose, '-') FROM chat_channels WHERE slack_channel_id = 'PGTAP_CH_PUB'),
  'Hello|-', 'empty topic and purpose become null'
);
SELECT throws_ok(
  $$INSERT INTO chat_channels (kind, visibility, restricted) VALUES ('group_dm', 'private', false)$$,
  '23514', NULL, 'a group DM cannot be unrestricted'
);
SELECT is(
  (SELECT count(*)::int FROM chat_channel_members cm JOIN chat_channels c ON c.id = cm.channel_id
    WHERE c.slack_channel_id LIKE 'PGTAP_CH_%'),
  6, 'matched members are projected into channel membership (six rows, one of them left)'
);
SELECT is(
  (SELECT left_at IS NOT NULL FROM chat_channel_members cm JOIN chat_channels c ON c.id = cm.channel_id
    WHERE c.slack_channel_id = 'PGTAP_CH_PRIV' AND cm.member_id = '00000000-0000-4000-a000-00000000f102'),
  true, 'someone who left keeps their row with left_at'
);
SELECT is(
  (SELECT count(*)::int FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id LIKE 'PGTAP_CH_%'),
  7, 'every bronze message is projected, deleted ones included'
);
SELECT is(
  (SELECT author_member_id::text FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id
    WHERE c.slack_channel_id = 'PGTAP_CH_PUB' AND slack_ts = '4070908800.000100'),
  '00000000-0000-4000-a000-00000000f101', 'a matched author is attributed'
);
SELECT is(
  (SELECT author_member_id FROM chat_messages WHERE slack_ts = '4070908802.000100'), NULL,
  'an unmatched author (a bot) has no member'
);
SELECT is(
  (SELECT has_files FROM chat_messages WHERE slack_ts = '4070908802.000100'), true, 'has_files comes from the files column'
);
SELECT is(
  (SELECT body || '|' || (blocks->0->>'type') FROM chat_message_contents cc JOIN chat_messages m ON m.id = cc.message_id
    WHERE m.slack_ts = '4070908800.000100'),
  'hello everyone|rich_text', 'content keeps the text and the rich_text blocks'
);
SELECT is(
  (SELECT r.thread_root_id = root.id FROM chat_messages r JOIN chat_messages root ON root.slack_ts = '4070908800.000100' AND root.channel_id = r.channel_id
    WHERE r.slack_ts = '4070908801.000100'),
  true, 'a reply points at its thread root'
);
SELECT is(
  (SELECT reply_count FROM chat_messages WHERE slack_ts = '4070908800.000100' AND channel_id = (SELECT id FROM chat_channels WHERE slack_channel_id = 'PGTAP_CH_PUB')),
  1, 'the root counts its replies'
);
SELECT is(
  (SELECT deleted_at IS NOT NULL FROM chat_messages WHERE slack_ts = '4070908806.000100'), true, 'a message deleted in Slack is soft-deleted'
);
SELECT is(
  (SELECT string_agg(emoji || ':' || COALESCE(member_id::text, 'unmatched') || ':' || (deleted_at IS NOT NULL)::text, ', ' ORDER BY emoji)
     FROM chat_reactions WHERE message_id = (SELECT id FROM chat_messages WHERE slack_ts = '4070908800.000100')),
  'eyes:unmatched:false, tada:00000000-0000-4000-a000-00000000f102:false, wave:00000000-0000-4000-a000-00000000f101:true',
  'reactions are projected with their member, or unmatched, and removed ones soft-deleted'
);

-- Access, as each person
CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "chat-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'fern_channels', count(*)::text FROM chat_channels WHERE slack_channel_id LIKE 'PGTAP_CH_%';
INSERT INTO result SELECT 'fern_messages', count(*)::text FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id LIKE 'PGTAP_CH_%';
INSERT INTO result SELECT 'fern_contents', count(*)::text FROM chat_message_contents cc JOIN chat_messages m ON m.id = cc.message_id JOIN chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id LIKE 'PGTAP_CH_%';

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a2", "email": "chat-gale@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'gale_channels', count(*)::text FROM chat_channels WHERE slack_channel_id LIKE 'PGTAP_CH_%';
INSERT INTO result SELECT 'gale_messages', count(*)::text FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id LIKE 'PGTAP_CH_%';
INSERT INTO result SELECT 'gale_contents', count(*)::text FROM chat_message_contents cc JOIN chat_messages m ON m.id = cc.message_id JOIN chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id LIKE 'PGTAP_CH_%';
INSERT INTO result SELECT 'gale_reactions', count(*)::text FROM chat_reactions r JOIN chat_messages m ON m.id = r.message_id JOIN chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id LIKE 'PGTAP_CH_%';

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a4", "email": "chat-bramble@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_channels', count(*)::text FROM chat_channels WHERE slack_channel_id LIKE 'PGTAP_CH_%';
INSERT INTO result SELECT 'admin_messages', count(*)::text FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id LIKE 'PGTAP_CH_%';
INSERT INTO result SELECT 'admin_contents', count(*)::text FROM chat_message_contents cc JOIN chat_messages m ON m.id = cc.message_id JOIN chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id LIKE 'PGTAP_CH_%';
SELECT throws_ok($$INSERT INTO chat_messages (channel_id, created_at) SELECT id, now() FROM chat_channels LIMIT 1$$, '42501', NULL, 'an admin cannot write chat messages');
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'fern_channels'), '4', 'a member sees public channels and the private ones they are in');
SELECT is((SELECT value FROM result WHERE label = 'fern_messages'), '7', 'and their messages, deleted ones as tombstones');
SELECT is((SELECT value FROM result WHERE label = 'fern_contents'), '6', 'and every live message''s content, restricted channels included (they are in them), never a deleted one');
SELECT is((SELECT value FROM result WHERE label = 'gale_channels'), '1', 'a member outside the private channels sees only public ones');
SELECT is((SELECT value FROM result WHERE label = 'gale_messages'), '4', 'and only their messages (three live, one tombstone)');
SELECT is((SELECT value FROM result WHERE label = 'gale_contents'), '3', 'and only live content');
SELECT is((SELECT value FROM result WHERE label = 'gale_reactions'), '3', 'and reactions on what they can see');
SELECT is((SELECT value FROM result WHERE label = 'admin_channels'), '4', 'an admin sees every channel (metadata)');
SELECT is((SELECT value FROM result WHERE label = 'admin_messages'), '7', 'and every message''s metadata');
SELECT is((SELECT value FROM result WHERE label = 'admin_contents'), '4', 'but content only outside restricted channels and group DMs');

-- Restricting takes effect at once; lifting restores it. Re-projecting changes nothing.
INSERT INTO public.restricted_slack_channels (channel_id, name) VALUES ('PGTAP_CH_PRIV', 'pgtap-private');
SELECT is((SELECT restricted FROM chat_channels WHERE slack_channel_id = 'PGTAP_CH_PRIV'), true, 'restricting a channel updates chat_channels immediately');
DELETE FROM public.restricted_slack_channels WHERE channel_id IN ('PGTAP_CH_PRIV', 'PGTAP_CH_QUIET');
SELECT is(
  (SELECT string_agg(slack_channel_id || ':' || restricted::text, ', ' ORDER BY slack_channel_id) FROM chat_channels WHERE slack_channel_id IN ('PGTAP_CH_PRIV', 'PGTAP_CH_QUIET', 'PGTAP_CH_MPIM')),
  'PGTAP_CH_MPIM:true, PGTAP_CH_PRIV:false, PGTAP_CH_QUIET:false',
  'lifting it unrestricts a channel but never a group DM'
);

CREATE TEMP TABLE before_ids ON COMMIT DROP AS SELECT id FROM chat_messages m WHERE slack_ts LIKE '40709088%';
UPDATE bronze.slack_messages SET deleted_at = '2099-01-01T00:09:00Z' WHERE message_ts = '4070908803.000100' AND channel_id = 'PGTAP_CH_PRIV';
UPDATE bronze.slack_messages SET deleted_at = NULL WHERE message_ts = '4070908806.000100' AND channel_id = 'PGTAP_CH_PUB';
SELECT project_slack_chat_channels((SELECT m FROM map));
SELECT project_slack_chat_messages('2099-01-01T00:00:00Z', '2099-01-01T00:10:00Z', (SELECT m FROM map));
SELECT is(
  (SELECT count(*)::int FROM chat_messages m WHERE slack_ts LIKE '40709088%' AND id NOT IN (SELECT id FROM before_ids)),
  0, 're-projecting keeps every id (and creates no duplicates)'
);
SELECT is(
  (SELECT (SELECT deleted_at IS NOT NULL FROM chat_messages WHERE slack_ts = '4070908803.000100')
       AND (SELECT deleted_at IS NULL FROM chat_messages WHERE slack_ts = '4070908806.000100')),
  true, 'a new delete in Bronze is carried over, and a message that came back is un-deleted'
);

-- The webhook's path: one message at a time, no map to compute.
SELECT ok(
  NOT has_function_privilege('authenticated', 'project_slack_chat_message(text, text)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.chat_slack_authors', 'SELECT'),
  'authenticated can neither project a message nor read the author map'
);
SELECT is(
  (SELECT count(*)::int FROM chat_slack_authors WHERE slack_user_id LIKE 'PGTAP_CU_%'),
  2, 'the full projection keeps the Slack user -> member map'
);

INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, raw_payload)
VALUES ('PGTAP_CH_FAST', 'pgtap-fast', false, false, '{}');
SELECT project_slack_chat_channels((SELECT m FROM map));

SELECT is(project_slack_chat_message('PGTAP_NOPE', '4070908810.000100') ->> 'projected', 'false', 'a channel the mirror does not know yet is left to the next full run');
SELECT is(project_slack_chat_message('PGTAP_CH_FAST', '4070908810.000100') ->> 'projected', 'false', 'so is a message Bronze does not have');

INSERT INTO bronze.slack_messages (message_ts, channel_id, channel_name, channel_type, user_id, text, thread_ts, occurred_at, raw_payload) VALUES
  ('4070908811.000100', 'PGTAP_CH_FAST', 'pgtap-fast', 'public_channel', 'PGTAP_CU_GALE', 'reply came first', '4070908810.000100', '2099-01-01T01:00:01Z', '{}'),
  ('4070908810.000100', 'PGTAP_CH_FAST', 'pgtap-fast', 'public_channel', 'PGTAP_CU_FERN', 'the root', NULL, '2099-01-01T01:00:00Z', '{}');
INSERT INTO bronze.slack_reactions (message_ts, channel_id, reaction, user_id, occurred_at, raw_payload)
VALUES ('4070908810.000100', 'PGTAP_CH_FAST', 'tada', 'PGTAP_CU_GALE', '2099-01-01T01:00:02Z', '{}');

SELECT is(project_slack_chat_message('PGTAP_CH_FAST', '4070908811.000100') ->> 'projected', 'true', 'a reply is projected on its own');
SELECT is(
  (SELECT thread_root_id FROM chat_messages WHERE slack_ts = '4070908811.000100'), NULL,
  'a reply that beats its root has no thread root yet'
);
SELECT project_slack_chat_message('PGTAP_CH_FAST', '4070908810.000100');
SELECT is(
  (SELECT r.thread_root_id = root.id AND root.reply_count = 1
     FROM chat_messages r JOIN chat_messages root ON root.slack_ts = '4070908810.000100' AND root.channel_id = r.channel_id
    WHERE r.slack_ts = '4070908811.000100'),
  true, 'the root adopts the reply and counts it'
);
SELECT is(
  (SELECT m.author_member_id::text || '|' || cc.body FROM chat_messages m JOIN chat_message_contents cc ON cc.message_id = m.id WHERE m.slack_ts = '4070908810.000100'),
  '00000000-0000-4000-a000-00000000f101|the root', 'author comes from the saved map, content from Bronze'
);
SELECT is(
  (SELECT r.emoji || ':' || r.member_id::text FROM chat_reactions r JOIN chat_messages m ON m.id = r.message_id WHERE m.slack_ts = '4070908810.000100'),
  'tada:00000000-0000-4000-a000-00000000f102', 'the message''s reactions come along'
);

CREATE TEMP TABLE fast_id ON COMMIT DROP AS SELECT id FROM chat_messages WHERE slack_ts = '4070908810.000100';
UPDATE bronze.slack_messages SET deleted_at = '2099-01-01T01:05:00Z' WHERE message_ts = '4070908811.000100' AND channel_id = 'PGTAP_CH_FAST';
SELECT project_slack_chat_message('PGTAP_CH_FAST', '4070908811.000100');
SELECT project_slack_chat_message('PGTAP_CH_FAST', '4070908810.000100');
SELECT is(
  (SELECT root.reply_count = 0 AND root.id = (SELECT id FROM fast_id)
        AND (SELECT deleted_at IS NOT NULL FROM chat_messages WHERE slack_ts = '4070908811.000100')
     FROM chat_messages root WHERE root.slack_ts = '4070908810.000100'),
  true, 'a deleted reply stops counting, and projecting again keeps the root''s id'
);

SELECT * FROM finish(true);
ROLLBACK;
