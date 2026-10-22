-- pgTAP tests for 20261203000100_chat_post_with_files.sql:
--  * chat_post_message takes files: text or files is enough, files must be 1 to 10 well-formed
--    'pending-' entries, and the message is saved with has_files and its file list;
--  * the three-argument form still works;
--  * Slack's event for a file upload is linked to our row by the real Slack file ids, once stored.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fda1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pfiles-fern@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000fda1', 'pfiles-fern@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000fd01', 'Files Poster', 'pfiles-fern@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id, bridge_mode) VALUES
  ('00000000-0000-4000-a000-00000000fdc1', 'channel', 'private', false, 'pfiles', 'PGTAP_PF_CHAN', 'bridged');
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES
  ('00000000-0000-4000-a000-00000000fdc1', '00000000-0000-4000-a000-00000000fd01');

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
CREATE FUNCTION public.pgtap_try_post_files(p_label text, p_body text, p_files jsonb) RETURNS void AS $$
BEGIN
  INSERT INTO result VALUES (p_label, 'ok:' || chat_post_message('00000000-0000-4000-a000-00000000fdc1', p_body, NULL, p_files)::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (p_label, SQLERRM);
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.pgtap_try_post_files(text, text, jsonb) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fda1", "email": "pfiles-fern@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try_post_files('files only', '', '[{"id":"pending-a","name":"cat.gif","mimetype":"image/gif","size":5,"staged":"staging/x/y/cat.gif"}]');
SELECT public.pgtap_try_post_files('files and text', 'look', '[{"id":"pending-b","name":"a.pdf"}]');
SELECT public.pgtap_try_post_files('nothing', '  ', NULL);
SELECT public.pgtap_try_post_files('empty list', '', '[]');
SELECT public.pgtap_try_post_files('not pending', 'x', '[{"id":"F123","name":"a.pdf"}]');
SELECT public.pgtap_try_post_files('no name', 'x', '[{"id":"pending-c"}]');
SELECT public.pgtap_try_post_files('too many', 'x', (SELECT jsonb_agg(jsonb_build_object('id', 'pending-' || n, 'name', 'f' || n)) FROM generate_series(1, 11) n));
RESET ROLE;

SELECT is(
  (SELECT (SELECT m.has_files::text || '|' || (c.files->0->>'name') FROM chat_messages m WHERE m.id = c.message_id)
   FROM chat_message_contents c WHERE c.message_id = (SELECT substr(value, 4)::uuid FROM result WHERE label = 'files only')),
  'true|cat.gif',
  'files alone make a message, saved with its file list and has_files'
);
SELECT ok((SELECT value LIKE 'ok:%' FROM result WHERE label = 'files and text'), 'text and files together are fine');
SELECT is((SELECT value FROM result WHERE label = 'nothing'), 'chat_post: empty', 'no text and no files is empty');
SELECT is((SELECT value FROM result WHERE label = 'empty list'), 'chat_post: empty', 'an empty file list is no files');
SELECT is(
  (SELECT string_agg(value, ',' ORDER BY label) FROM result WHERE label IN ('not pending', 'no name', 'too many')),
  'chat_post: bad_files,chat_post: bad_files,chat_post: bad_files',
  'files must be pending entries with a name, at most ten'
);

-- The old three-argument form still posts text.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fda1", "email": "pfiles-fern@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT chat_post_message('00000000-0000-4000-a000-00000000fdc1', 'plain text')$$, 'the three-argument form still works');
RESET ROLE;

-- Slack's event for the upload: nothing to match while our row still has pending ids; once the real
-- ids are stored, the event takes the ts and marks the row sent instead of becoming a second message.
UPDATE chat_message_contents SET files = '[{"id":"F_PGTAP_PF1","name":"cat.gif"}]'
WHERE message_id = (SELECT substr(value, 4)::uuid FROM result WHERE label = 'files only');
INSERT INTO bronze.slack_messages (message_ts, channel_id, channel_name, channel_type, user_id, text, occurred_at, files, raw_payload) VALUES
  ('4070909000.000100', 'PGTAP_PF_CHAN', 'pfiles', 'private_channel', 'U_PGTAP_PF', '', '2099-01-01T00:00:00Z', '[{"id":"F_PGTAP_PF1"}]', '{}');
SELECT is(
  (SELECT slack_ts || '|' || slack_sync_status FROM chat_messages WHERE id = (SELECT substr(value, 4)::uuid FROM result WHERE label = 'files only')),
  '4070909000.000100|sent',
  'Slack''s upload event is matched to our message by file id'
);

SELECT * FROM finish(true);
ROLLBACK;
