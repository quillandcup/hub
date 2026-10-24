-- pgTAP tests for 20261208000000_chat_delete_file.sql: an author removes one file from their own
-- message (the others stay; a message written in Slack counts, see 20261226000000); someone else, a
-- deleted message and a notice Slack posted are refused. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

SELECT ok(NOT has_function_privilege('anon', 'chat_delete_file(text, text)', 'EXECUTE'), 'anon cannot remove a file');
SELECT ok(has_function_privilege('authenticated', 'chat_delete_file(text, text)', 'EXECUTE'), 'authenticated can');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fea1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'df-fern@example.test'),
  ('00000000-0000-4000-a000-00000000fea2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'df-gale@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000fea1', 'df-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000fea2', 'df-gale@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAfeA1', 'Df Fern', 'df-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAfeA2', 'Df Gale', 'df-gale@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('chn_AAAAAAAAfec1', 'channel', 'public', false, 'df-live', 'PGTAP_DF_LIVE');

-- e1 Fern's Hub message with two files; e2 Gale's; e3 a notice Slack posted about Fern; e4 Fern's, deleted; e5 Fern's with one file.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, origin, slack_ts, created_at, deleted_at) VALUES
  ('msg_AAAAAAAAfed1', 'chn_AAAAAAAAfec1', 'mbr_AAAAAAAAfeA1', 'app', '5.1', '2020-01-01', NULL),
  ('msg_AAAAAAAAfed2', 'chn_AAAAAAAAfec1', 'mbr_AAAAAAAAfeA2', 'app', '5.2', '2020-01-02', NULL),
  ('msg_AAAAAAAAfed3', 'chn_AAAAAAAAfec1', 'mbr_AAAAAAAAfeA1', 'slack', '5.3', '2020-01-03', NULL),
  ('msg_AAAAAAAAfed4', 'chn_AAAAAAAAfec1', 'mbr_AAAAAAAAfeA1', 'app', '5.4', '2020-01-04', now()),
  ('msg_AAAAAAAAfed5', 'chn_AAAAAAAAfec1', 'mbr_AAAAAAAAfeA1', 'app', '5.5', '2020-01-05', NULL);
UPDATE public.chat_messages SET system_subtype = 'channel_join' WHERE id = 'msg_AAAAAAAAfed3';
INSERT INTO public.chat_message_contents (message_id, body, files) VALUES
  ('msg_AAAAAAAAfed1', 'two', '[{"id":"F1"},{"id":"F2"}]'::jsonb),
  ('msg_AAAAAAAAfed2', 'gale', '[{"id":"F1"}]'::jsonb),
  ('msg_AAAAAAAAfed3', 'slack', '[{"id":"F1"}]'::jsonb),
  ('msg_AAAAAAAAfed4', 'gone', '[{"id":"F1"}]'::jsonb),
  ('msg_AAAAAAAAfed5', 'one', '[{"id":"F1"}]'::jsonb);

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
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fea1", "email": "df-fern@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try('own', $$ SELECT chat_delete_file('msg_AAAAAAAAfed1', 'F1') $$);
SELECT public.pgtap_try('others', $$ SELECT chat_delete_file('msg_AAAAAAAAfed2', 'F1') $$);
SELECT public.pgtap_try('slack', $$ SELECT chat_delete_file('msg_AAAAAAAAfed3', 'F1') $$);
SELECT public.pgtap_try('deleted', $$ SELECT chat_delete_file('msg_AAAAAAAAfed4', 'F1') $$);
SELECT public.pgtap_try('last', $$ SELECT chat_delete_file('msg_AAAAAAAAfed5', 'F1') $$);
RESET ROLE;

SELECT is((SELECT files::text FROM chat_message_contents WHERE message_id = 'msg_AAAAAAAAfed1'), '[{"id": "F2"}]', 'the author removes one file and the other stays');
SELECT is(
  (SELECT string_agg(value, ',' ORDER BY label) FROM result WHERE label IN ('others', 'slack', 'deleted')),
  'chat_delete: not_yours,chat_delete: not_yours,chat_delete: not_yours',
  'someone else''s, a Slack notice and a deleted message are refused'
);
SELECT is(
  (SELECT count(*)::int FROM chat_message_contents WHERE message_id IN ('msg_AAAAAAAAfed2', 'msg_AAAAAAAAfed3', 'msg_AAAAAAAAfed4') AND files = '[{"id":"F1"}]'::jsonb),
  3,
  'the refused messages keep their files'
);
SELECT ok((SELECT files IS NULL FROM chat_message_contents WHERE message_id = 'msg_AAAAAAAAfed5'), 'removing the last file leaves no list');

SELECT * FROM finish(true);
ROLLBACK;
