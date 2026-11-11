-- pgTAP tests for 20270625000000_zoom_chat_messages.sql: admins can't read the text, who a private message
-- went to or the raw payload of a Zoom chat message from Bronze, only the metadata view; members read
-- nothing; a redelivered message is refused by the unique key; a prickle type's chat is private unless
-- someone says otherwise.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(17);

-- Grants: the content columns are closed to API roles.
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.zoom_chat_messages', 'SELECT'), 'authenticated has no table-wide SELECT on zoom_chat_messages');
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.zoom_chat_messages', 'INSERT'), 'authenticated cannot write zoom_chat_messages');
SELECT ok(
  NOT has_column_privilege('authenticated', 'bronze.zoom_chat_messages', 'message_text', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'bronze.zoom_chat_messages', 'recipient_name', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'bronze.zoom_chat_messages', 'recipient_email', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'bronze.zoom_chat_messages', 'raw_payload', 'SELECT'),
  'authenticated cannot read the text, the recipient or the raw payload of a chat message'
);
-- A column added later without its own GRANT SELECT (col) ... TO authenticated fails here.
SELECT is(
  (SELECT string_agg(column_name, ', ') FROM information_schema.columns
    WHERE table_schema = 'bronze' AND table_name = 'zoom_chat_messages'
      AND column_name NOT IN ('message_text', 'recipient_name', 'recipient_email', 'raw_payload')
      AND NOT has_column_privilege('authenticated', 'bronze.zoom_chat_messages', column_name, 'SELECT')),
  NULL,
  'every other column of zoom_chat_messages is granted to authenticated'
);
SELECT ok(NOT has_table_privilege('anon', 'bronze.zoom_chat_messages_meta', 'SELECT'), 'anon cannot read zoom_chat_messages_meta');
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'bronze' AND table_name = 'zoom_chat_messages_meta'
      AND column_name IN ('message_text', 'recipient_name', 'recipient_email', 'raw_payload')),
  0,
  'zoom_chat_messages_meta has no content columns'
);
SELECT ok(has_column_privilege('service_role', 'bronze.zoom_chat_messages', 'message_text', 'SELECT'), 'the service role reads the text');

-- Fern is a member, Bramble an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zoomchat-fern@example.test'),
  ('00000000-0000-4000-a000-00000000e1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zoomchat-bramble@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'zoomchat-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a4', 'zoomchat-bramble@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO bronze.zoom_chat_messages
  (meeting_uuid, meeting_id, message_id, sent_at, sender_name, recipient_type, recipient_name, recipient_email, message_text, has_files, raw_payload)
VALUES
  ('pgtap-zoomchat-meeting', '999', 'msg-1', '2099-01-01T00:00:00Z', 'Fern Example', 'guest', 'Bea Example', 'bea@example.test', 'a private line', true, '{}');

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- A member sees nothing.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "zoomchat-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_meta', count(*)::text FROM bronze.zoom_chat_messages_meta WHERE meeting_uuid = 'pgtap-zoomchat-meeting';

-- An admin reads metadata, not content.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000e1a4", "email": "zoomchat-bramble@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_meta', count(*)::text FROM bronze.zoom_chat_messages_meta WHERE meeting_uuid = 'pgtap-zoomchat-meeting';
INSERT INTO result SELECT 'admin_has_files', has_files::text FROM bronze.zoom_chat_messages_meta WHERE meeting_uuid = 'pgtap-zoomchat-meeting';
SELECT throws_ok($$SELECT message_text FROM bronze.zoom_chat_messages LIMIT 1$$, '42501', NULL, 'an admin cannot read the text of a chat message');
SELECT throws_ok($$SELECT recipient_email FROM bronze.zoom_chat_messages LIMIT 1$$, '42501', NULL, 'an admin cannot read who a private message went to');
SELECT throws_ok($$SELECT raw_payload FROM bronze.zoom_chat_messages LIMIT 1$$, '42501', NULL, 'an admin cannot read the raw payload of a chat message');
SELECT throws_ok(
  $$INSERT INTO bronze.zoom_chat_messages (meeting_uuid, message_id, sent_at, raw_payload) VALUES ('x', 'y', now(), '{}')$$,
  '42501', NULL, 'an admin cannot write a chat message'
);
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member_meta'), '0', 'a member sees no chat metadata');
SELECT is((SELECT value FROM result WHERE label = 'admin_meta'), '1', 'an admin sees chat metadata');
SELECT is((SELECT value FROM result WHERE label = 'admin_has_files'), 'true', 'the view says whether a message had files');

SELECT throws_ok(
  $$INSERT INTO bronze.zoom_chat_messages (meeting_uuid, message_id, sent_at, raw_payload) VALUES ('pgtap-zoomchat-meeting', 'msg-1', now(), '{}')$$,
  '23505', NULL, 'a redelivered message is refused by the unique key'
);

-- A prickle type's chat is private until someone says otherwise.
INSERT INTO public.prickle_types (name, normalized_name) VALUES ('Pgtap Chat Type', 'pgtap-chat-type');
SELECT is((SELECT chat_visibility FROM public.prickle_types WHERE normalized_name = 'pgtap-chat-type'), 'private', 'a new prickle type''s chat is private');
SELECT throws_ok(
  $$UPDATE public.prickle_types SET chat_visibility = 'semi' WHERE normalized_name = 'pgtap-chat-type'$$,
  '23514', NULL, 'chat visibility is public or private'
);

SELECT * FROM finish(true);
ROLLBACK;
