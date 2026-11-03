-- pgTAP tests for 20270428000000_chat_add_message_files.sql: an author adds files to their own message (appended,
-- none twice); someone else, a deleted message, a Slack notice and an empty list are refused. Rolled back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(10);

SELECT ok(NOT has_function_privilege('anon', 'chat_add_message_files(text, jsonb)', 'EXECUTE'), 'anon cannot add files');
SELECT ok(has_function_privilege('authenticated', 'chat_add_message_files(text, jsonb)', 'EXECUTE'), 'authenticated can');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fab1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'af-fern@example.test'),
  ('00000000-0000-4000-a000-00000000fab2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'af-gale@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000fab1', 'af-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000fab2', 'af-gale@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAfbA1', 'Af Fern', 'af-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAfbA2', 'Af Gale', 'af-gale@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('chn_AAAAAAAAfbc1', 'channel', 'public', false, 'af-live', 'PGTAP_AF_LIVE');

INSERT INTO public.chat_messages (id, channel_id, author_member_id, origin, slack_ts, created_at, deleted_at) VALUES
  ('msg_AAAAAAAAfbd1', 'chn_AAAAAAAAfbc1', 'mbr_AAAAAAAAfbA1', 'app', '6.1', '2020-01-01', NULL),
  ('msg_AAAAAAAAfbd2', 'chn_AAAAAAAAfbc1', 'mbr_AAAAAAAAfbA2', 'app', '6.2', '2020-01-02', NULL),
  ('msg_AAAAAAAAfbd3', 'chn_AAAAAAAAfbc1', 'mbr_AAAAAAAAfbA1', 'slack', '6.3', '2020-01-03', NULL),
  ('msg_AAAAAAAAfbd4', 'chn_AAAAAAAAfbc1', 'mbr_AAAAAAAAfbA1', 'app', '6.4', '2020-01-04', now()),
  ('msg_AAAAAAAAfbd5', 'chn_AAAAAAAAfbc1', 'mbr_AAAAAAAAfbA1', 'slack', '6.5', '2020-01-05', NULL),
  ('msg_AAAAAAAAfbd6', 'chn_AAAAAAAAfbc1', 'mbr_AAAAAAAAfbA1', 'app', '6.6', '2020-01-06', NULL);
UPDATE public.chat_messages SET system_subtype = 'channel_join' WHERE id = 'msg_AAAAAAAAfbd3';
INSERT INTO public.chat_message_contents (message_id, body, files) VALUES
  ('msg_AAAAAAAAfbd1', 'one', '[{"id":"F1"}]'::jsonb),
  ('msg_AAAAAAAAfbd2', 'gale', NULL),
  ('msg_AAAAAAAAfbd3', 'notice', NULL),
  ('msg_AAAAAAAAfbd4', 'gone', NULL),
  ('msg_AAAAAAAAfbd5', 'none yet', NULL),
  ('msg_AAAAAAAAfbd6', 'stub', '[{"id":"F7","name":"s.png","mimetype":""}]'::jsonb);

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
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fab1", "email": "af-fern@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try('own', $$ SELECT chat_add_message_files('msg_AAAAAAAAfbd1', '[{"id":"F1"},{"id":"F2","name":"b.png"}]'::jsonb) $$);
SELECT public.pgtap_try('first', $$ SELECT chat_add_message_files('msg_AAAAAAAAfbd5', '[{"id":"F9"}]'::jsonb) $$);
SELECT public.pgtap_try('others', $$ SELECT chat_add_message_files('msg_AAAAAAAAfbd2', '[{"id":"F3"}]'::jsonb) $$);
SELECT public.pgtap_try('notice', $$ SELECT chat_add_message_files('msg_AAAAAAAAfbd3', '[{"id":"F3"}]'::jsonb) $$);
SELECT public.pgtap_try('deleted', $$ SELECT chat_add_message_files('msg_AAAAAAAAfbd4', '[{"id":"F3"}]'::jsonb) $$);
SELECT public.pgtap_try('stub', $$ SELECT chat_add_message_files('msg_AAAAAAAAfbd6', '[{"id":"F7","name":"s.png","mimetype":"image/png","size":5},{"id":"F8","name":"t.png","mimetype":"","size":6}]'::jsonb) $$);
SELECT public.pgtap_try('empty', $$ SELECT chat_add_message_files('msg_AAAAAAAAfbd1', '[]'::jsonb) $$);
RESET ROLE;

SELECT is((SELECT files FROM chat_message_contents WHERE message_id = 'msg_AAAAAAAAfbd1'), '[{"id": "F1"}, {"id": "F2", "name": "b.png", "mimetype": "image/png"}]'::jsonb, 'files are appended and one already listed is not added twice');
SELECT is((SELECT files::text FROM chat_message_contents WHERE message_id = 'msg_AAAAAAAAfbd5') || (SELECT has_files::text FROM chat_messages WHERE id = 'msg_AAAAAAAAfbd5'), '[{"id": "F9"}]true', 'a message without files gets its first, and is marked as having files');
SELECT is(
  (SELECT string_agg(value, ',' ORDER BY label) FROM result WHERE label IN ('others', 'notice', 'deleted', 'empty')),
  'chat_edit: bad_files,chat_edit: not_yours,chat_edit: not_yours,chat_edit: not_yours',
  'someone else''s, a Slack notice, a deleted message and an empty list are refused'
);
SELECT is((SELECT count(*)::int FROM chat_message_contents WHERE message_id IN ('msg_AAAAAAAAfbd2', 'msg_AAAAAAAAfbd3', 'msg_AAAAAAAAfbd4') AND files IS NULL), 3, 'the refused messages are untouched');
SELECT is(
  (SELECT files FROM chat_message_contents WHERE message_id = 'msg_AAAAAAAAfbd6'),
  '[{"id": "F7", "name": "s.png", "size": 5, "mimetype": "image/png"}, {"id": "F8", "name": "t.png", "size": 6, "mimetype": "image/png"}]'::jsonb,
  'an entry listed without a mimetype is completed, and a new file with an empty one gets an image mimetype from its name'
);
SELECT is((SELECT value FROM result WHERE label = 'stub'), 'ok', 'adding to a message whose list has a stub works');
SELECT is((SELECT jsonb_path_query_first(files, '$[*] ? (@.id == "F8").mimetype') #>> '{}' FROM chat_message_contents WHERE message_id = 'msg_AAAAAAAAfbd6'), 'image/png', 'the appended file is an inline image');
SELECT * FROM finish(true);
ROLLBACK;
