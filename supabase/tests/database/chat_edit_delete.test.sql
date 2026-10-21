-- pgTAP tests for 20261130000000_chat_edit_delete.sql: a member edits and deletes only their own
-- messages written in the Hub (not Slack's, not someone else's, not a deleted one, not in an
-- archived conversation), edits are trimmed and bounded like posts, a delete is soft and keeps the
-- text, and a deleted reply stops counting toward its thread.
-- Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(11);

SELECT ok(NOT has_function_privilege('anon', 'chat_edit_message(uuid, text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'chat_delete_message(uuid)', 'EXECUTE'), 'anon can do neither');
SELECT ok(has_function_privilege('authenticated', 'chat_edit_message(uuid, text)', 'EXECUTE') AND has_function_privilege('authenticated', 'chat_delete_message(uuid)', 'EXECUTE'), 'authenticated can do both');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fda1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ed-fern@example.test'),
  ('00000000-0000-4000-a000-00000000fda2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ed-gale@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000fda1', 'ed-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000fda2', 'ed-gale@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000fd01', 'Ed Fern', 'ed-fern@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000fd02', 'Ed Gale', 'ed-gale@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id, archived_at) VALUES
  ('00000000-0000-4000-a000-00000000fdc1', 'channel', 'public', false, 'ed-live', 'PGTAP_ED_LIVE', NULL),
  ('00000000-0000-4000-a000-00000000fdc2', 'channel', 'public', false, 'ed-old', 'PGTAP_ED_OLD', now());

-- d1 Fern's Hub root; d2 Fern's Hub reply to it; d3 Gale's Hub message; d4 Fern's message written in Slack;
-- d5 Fern's Hub message in the archived conversation.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, origin, slack_ts, created_at, reply_count) VALUES
  ('00000000-0000-4000-a000-00000000fdd1', '00000000-0000-4000-a000-00000000fdc1', '00000000-0000-4000-a000-00000000fd01', NULL, 'app', '4.1', '2020-01-01', 1),
  ('00000000-0000-4000-a000-00000000fdd2', '00000000-0000-4000-a000-00000000fdc1', '00000000-0000-4000-a000-00000000fd01', '00000000-0000-4000-a000-00000000fdd1', 'app', '4.2', '2020-01-02', 0),
  ('00000000-0000-4000-a000-00000000fdd3', '00000000-0000-4000-a000-00000000fdc1', '00000000-0000-4000-a000-00000000fd02', NULL, 'app', '4.3', '2020-01-03', 0),
  ('00000000-0000-4000-a000-00000000fdd4', '00000000-0000-4000-a000-00000000fdc1', '00000000-0000-4000-a000-00000000fd01', NULL, 'slack', '4.4', '2020-01-04', 0),
  ('00000000-0000-4000-a000-00000000fdd5', '00000000-0000-4000-a000-00000000fdc2', '00000000-0000-4000-a000-00000000fd01', NULL, 'app', '4.5', '2020-01-05', 0);
INSERT INTO public.chat_message_contents (message_id, body) VALUES
  ('00000000-0000-4000-a000-00000000fdd1', 'root'), ('00000000-0000-4000-a000-00000000fdd2', 'reply'),
  ('00000000-0000-4000-a000-00000000fdd3', 'gale'), ('00000000-0000-4000-a000-00000000fdd4', 'slack'), ('00000000-0000-4000-a000-00000000fdd5', 'old');
UPDATE public.chat_messages SET last_reply_at = '2020-01-02' WHERE id = '00000000-0000-4000-a000-00000000fdd1';

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
CREATE FUNCTION public.pgtap_try(p_label text, p_sql text) RETURNS void AS $$
BEGIN
  EXECUTE p_sql;
  INSERT INTO result VALUES (p_label, 'ok');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (p_label, SQLERRM);
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.pgtap_try(text, text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fda1", "email": "ed-fern@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try('edit own', $$ SELECT chat_edit_message('00000000-0000-4000-a000-00000000fdd1', E'  new text \n') $$);
SELECT public.pgtap_try('edit empty', $$ SELECT chat_edit_message('00000000-0000-4000-a000-00000000fdd1', '   ') $$);
SELECT public.pgtap_try('edit long', $$ SELECT chat_edit_message('00000000-0000-4000-a000-00000000fdd1', repeat('x', 4001)) $$);
SELECT public.pgtap_try('edit others', $$ SELECT chat_edit_message('00000000-0000-4000-a000-00000000fdd3', 'mine now') $$);
SELECT public.pgtap_try('edit slack', $$ SELECT chat_edit_message('00000000-0000-4000-a000-00000000fdd4', 'mine now') $$);
SELECT public.pgtap_try('edit archived', $$ SELECT chat_edit_message('00000000-0000-4000-a000-00000000fdd5', 'too late') $$);
SELECT public.pgtap_try('delete others', $$ SELECT chat_delete_message('00000000-0000-4000-a000-00000000fdd3') $$);
SELECT public.pgtap_try('delete slack', $$ SELECT chat_delete_message('00000000-0000-4000-a000-00000000fdd4') $$);
SELECT public.pgtap_try('delete reply', $$ SELECT chat_delete_message('00000000-0000-4000-a000-00000000fdd2') $$);
SELECT public.pgtap_try('delete reply again', $$ SELECT chat_delete_message('00000000-0000-4000-a000-00000000fdd2') $$);
SELECT public.pgtap_try('edit deleted', $$ SELECT chat_edit_message('00000000-0000-4000-a000-00000000fdd2', 'back') $$);
RESET ROLE;

SELECT is(
  (SELECT concat_ws('|', c.body, (m.edited_at IS NOT NULL)::text) FROM chat_messages m JOIN chat_message_contents c ON c.message_id = m.id WHERE m.id = '00000000-0000-4000-a000-00000000fdd1'),
  'new text|true',
  'an edit replaces the (trimmed) text and stamps edited_at'
);
SELECT is(
  (SELECT string_agg(value, ',' ORDER BY label) FROM result WHERE label IN ('edit empty', 'edit long')),
  'chat_edit: empty,chat_edit: too_long',
  'an empty or over-long edit is refused, like a post'
);
SELECT is(
  (SELECT string_agg(value, ',' ORDER BY label) FROM result WHERE label IN ('edit others', 'edit slack', 'delete others', 'delete slack')),
  'chat_delete: not_yours,chat_delete: not_yours,chat_edit: not_yours,chat_edit: not_yours',
  'someone else''s message or one written in Slack is neither editable nor deletable from the Hub'
);
SELECT is((SELECT value FROM result WHERE label = 'edit archived'), 'chat_edit: archived', 'an archived conversation takes no edits');
SELECT is(
  (SELECT concat_ws('|', (deleted_at IS NOT NULL)::text, (SELECT body FROM chat_message_contents WHERE message_id = m.id)) FROM chat_messages m WHERE id = '00000000-0000-4000-a000-00000000fdd2'),
  'true|reply',
  'a delete is soft and keeps the text'
);
SELECT is((SELECT concat_ws('|', reply_count, coalesce(last_reply_at::text, 'none')) FROM chat_messages WHERE id = '00000000-0000-4000-a000-00000000fdd1'), '0|none', 'a deleted reply no longer counts toward its thread');
SELECT is((SELECT value FROM result WHERE label = 'delete reply again'), 'ok', 'deleting twice is harmless');
SELECT is((SELECT value FROM result WHERE label = 'edit deleted'), 'chat_edit: not_yours', 'a deleted message can''t be edited back');
SELECT ok(
  (SELECT edited_at IS NULL FROM chat_messages WHERE id = '00000000-0000-4000-a000-00000000fdd3'),
  'and nobody''s edit touched Gale''s message'
);

SELECT * FROM finish(true);
ROLLBACK;
