-- pgTAP tests for 20261202000000_chat_message_files.sql:
--  * chat_slack_files_summary keeps only what the Hub shows (id, name, type, size, dimensions);
--  * projecting a Slack message with files fills chat_message_contents.files, and a later edit keeps it;
--  * a message written in the Hub (no Bronze row) keeps the files its writer set;
--  * a member reads the files of a message in a public channel only while it is not deleted.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fca1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cfiles-fern@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000fca1', 'cfiles-fern@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000fc01', 'Files Fern', 'cfiles-fern@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('00000000-0000-4000-a000-00000000fcc1', 'channel', 'public', false, 'cfiles', 'PGTAP_CF_CHAN');

SELECT is(
  public.chat_slack_files_summary('[{"id":"F1","name":"cat.gif","mimetype":"image/gif","size":1234,"original_w":400,"original_h":300,"url_private":"https://x"},{"title":"no id"},{"id":"F2","title":"Notes","mimetype":"application/pdf"}]'::jsonb),
  '[{"id":"F1","name":"cat.gif","width":400,"height":300,"mimetype":"image/gif","size":1234},{"id":"F2","name":"Notes","mimetype":"application/pdf"}]'::jsonb,
  'the summary keeps id, name, type, size and dimensions, and drops entries without an id and the private URLs'
);
SELECT is(public.chat_slack_files_summary(NULL), NULL::jsonb, 'no files is null');

INSERT INTO bronze.slack_messages (message_ts, channel_id, channel_name, channel_type, user_id, text, occurred_at, files, raw_payload) VALUES
  ('4070908900.000100', 'PGTAP_CF_CHAN', 'cfiles', 'public_channel', 'U_NOBODY', 'look at this', '2099-01-01T00:00:00Z',
   '[{"id":"F1","name":"cat.gif","mimetype":"image/gif","size":1234,"original_w":400,"original_h":300}]', '{}');
SELECT project_slack_chat_message('PGTAP_CF_CHAN', '4070908900.000100');

SELECT is(
  (SELECT c.files->0->>'id' FROM chat_message_contents c JOIN chat_messages m ON m.id = c.message_id WHERE m.slack_ts = '4070908900.000100'),
  'F1',
  'a projected Slack message carries its files'
);

UPDATE bronze.slack_messages SET text = 'look at this (edited)' WHERE message_ts = '4070908900.000100';
SELECT project_slack_chat_message('PGTAP_CF_CHAN', '4070908900.000100');
SELECT is(
  (SELECT c.files->0->>'name' FROM chat_message_contents c JOIN chat_messages m ON m.id = c.message_id WHERE m.slack_ts = '4070908900.000100'),
  'cat.gif',
  'an edit keeps them'
);

INSERT INTO chat_messages (id, channel_id, author_member_id, slack_ts, created_at, origin, slack_sync_status, has_files) VALUES
  ('00000000-0000-4000-a000-00000000fcd1', '00000000-0000-4000-a000-00000000fcc1', '00000000-0000-4000-a000-00000000fc01', NULL, now(), 'app', 'pending', true);
INSERT INTO chat_message_contents (message_id, body, files) VALUES
  ('00000000-0000-4000-a000-00000000fcd1', 'from the hub', '[{"id":"F9","name":"photo.png","mimetype":"image/png"}]');
UPDATE chat_message_contents SET body = 'from the hub!' WHERE message_id = '00000000-0000-4000-a000-00000000fcd1';
SELECT is(
  (SELECT files->0->>'id' FROM chat_message_contents WHERE message_id = '00000000-0000-4000-a000-00000000fcd1'),
  'F9',
  'a Hub-written message keeps the files its writer set'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fca1", "email": "cfiles-fern@example.test", "role": "authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM chat_message_contents WHERE files IS NOT NULL AND message_id IN (SELECT id FROM chat_messages WHERE channel_id = '00000000-0000-4000-a000-00000000fcc1')),
  2,
  'a member reads the files of messages in a public channel'
);

SELECT * FROM finish(true);
ROLLBACK;
