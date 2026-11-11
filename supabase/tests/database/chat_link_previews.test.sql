-- pgTAP tests for 20270622000000_chat_link_previews.sql:
--  * whoever can read a live message's text sees its link previews, and nobody else does: a private conversation the
--    member is not in and a deleted message show nothing;
--  * nobody but the service role writes previews (the server fetches the page after the message is sent);
--  * the row goes with its message, a message has one preview per address, and the table's checks refuse a picture
--    that is not https and a position past the third link;
--  * the author of a message (a Hub message or a Slack one matched to them) removes a card from it, once per card, and only
--    the author; everyone who can read the message sees the mark, nobody else does, and nobody can add one to someone else's message;
--  * the chat_link_previews feature flag exists and is off for everyone.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(20);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000cb01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lprev-fern@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000cb01', 'lprev-fern@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_PGTAPLPRV001', 'Preview Fern', 'lprev-fern@example.test', now(), 'active'),
  ('mbr_PGTAPLPRV002', 'Preview Moss', 'lprev-moss@example.test', now(), 'active');

INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('chn_PGTAPLPRV001', 'channel', 'public', false, 'lprev-open', 'PGTAP_LP_OPEN'),
  ('chn_PGTAPLPRV002', 'channel', 'private', true, 'lprev-closed', 'PGTAP_LP_CLOSED');
-- 001 Fern's Hub message, 002 in a private channel, 003 Moss's, 004 deleted, 005 Fern's message that came from Slack.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, created_at, origin, slack_sync_status, slack_ts) VALUES
  ('msg_PGTAPLPRV001', 'chn_PGTAPLPRV001', 'mbr_PGTAPLPRV001', now(), 'app', 'sent', NULL),
  ('msg_PGTAPLPRV002', 'chn_PGTAPLPRV002', 'mbr_PGTAPLPRV001', now(), 'app', 'sent', NULL),
  ('msg_PGTAPLPRV003', 'chn_PGTAPLPRV001', 'mbr_PGTAPLPRV002', now(), 'app', 'sent', NULL),
  ('msg_PGTAPLPRV004', 'chn_PGTAPLPRV001', 'mbr_PGTAPLPRV001', now(), 'app', 'sent', NULL),
  ('msg_PGTAPLPRV005', 'chn_PGTAPLPRV001', 'mbr_PGTAPLPRV001', now(), 'slack', NULL, '1700000000.000100');
INSERT INTO public.chat_message_contents (message_id, body) VALUES
  ('msg_PGTAPLPRV001', 'open'), ('msg_PGTAPLPRV002', 'closed'), ('msg_PGTAPLPRV003', 'third'), ('msg_PGTAPLPRV004', 'fourth'), ('msg_PGTAPLPRV005', 'fifth');

INSERT INTO public.chat_link_previews (message_id, position, url, status, title, description, site_name, image_url) VALUES
  ('msg_PGTAPLPRV001', 0, 'https://example.test/a', 'ok', 'A & <B>', 'About a', 'Example', 'https://example.test/a.png'),
  ('msg_PGTAPLPRV002', 0, 'https://example.test/b', 'ok', 'Closed', NULL, NULL, NULL),
  ('msg_PGTAPLPRV004', 0, 'https://example.test/d', 'ok', 'Deleted message', NULL, NULL, NULL);
UPDATE public.chat_messages SET deleted_at = now() WHERE id = 'msg_PGTAPLPRV004';

SELECT matches((SELECT id FROM public.chat_link_previews WHERE message_id = 'msg_PGTAPLPRV001'), '^lprv_[1-9A-HJ-NP-Za-km-z]{12}$', 'the id has the lprv_ prefix');
SELECT throws_ok(
  $$INSERT INTO public.chat_link_previews (message_id, position, url, status) VALUES ('msg_PGTAPLPRV001', 1, 'https://example.test/a', 'ok')$$,
  '23505', NULL, 'a message has one preview per address'
);
SELECT throws_ok(
  $$INSERT INTO public.chat_link_previews (message_id, position, url, status, image_url) VALUES ('msg_PGTAPLPRV001', 1, 'https://example.test/e', 'ok', 'http://example.test/e.png')$$,
  '23514', NULL, 'a picture must be https'
);
SELECT throws_ok(
  $$INSERT INTO public.chat_link_previews (message_id, position, url, status) VALUES ('msg_PGTAPLPRV001', 3, 'https://example.test/f', 'ok')$$,
  '23514', NULL, 'only the first three links get a preview'
);
SELECT throws_ok(
  $$INSERT INTO public.chat_hidden_unfurls (message_id, key) VALUES ('msg_PGTAPLPRV001', 'javascript:alert(1)')$$,
  '23514', NULL, 'a removed card is named by an address or a position, nothing else'
);
SELECT is(
  (SELECT enabled_globally FROM public.feature_flags WHERE feature_key = 'chat_link_previews'),
  false,
  'the chat_link_previews flag exists and is off for everyone'
);

INSERT INTO public.chat_hidden_unfurls (message_id, key) VALUES
  ('msg_PGTAPLPRV003', 'url:https://example.test/c'),
  ('msg_PGTAPLPRV002', 'idx:0');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cb01", "email": "lprev-fern@example.test", "role": "authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.chat_link_previews WHERE message_id = 'msg_PGTAPLPRV001'), 1, 'a member sees the preview on a message in a public channel');
SELECT is((SELECT title FROM public.chat_link_previews WHERE message_id = 'msg_PGTAPLPRV001'), 'A & <B>', 'the text is stored as plain text, as given');
SELECT is((SELECT count(*)::int FROM public.chat_link_previews WHERE message_id = 'msg_PGTAPLPRV002'), 0, 'a member who is not in a private channel does not see its previews');
SELECT is((SELECT count(*)::int FROM public.chat_link_previews WHERE message_id = 'msg_PGTAPLPRV004'), 0, 'a deleted message shows no preview');
SELECT throws_ok(
  $$INSERT INTO public.chat_link_previews (message_id, position, url, status) VALUES ('msg_PGTAPLPRV001', 1, 'https://example.test/g', 'ok')$$,
  '42501', NULL, 'a member cannot add a preview'
);

SELECT lives_ok(
  $$INSERT INTO public.chat_hidden_unfurls (message_id, key) VALUES ('msg_PGTAPLPRV001', 'url:https://example.test/a')$$,
  'the author removes a card from their own Hub message'
);
SELECT lives_ok(
  $$INSERT INTO public.chat_hidden_unfurls (message_id, key) VALUES ('msg_PGTAPLPRV005', 'idx:0')$$,
  'and from their own message that came from Slack'
);
SELECT throws_ok(
  $$INSERT INTO public.chat_hidden_unfurls (message_id, key) VALUES ('msg_PGTAPLPRV003', 'url:https://example.test/x')$$,
  '42501', NULL, 'a member cannot remove a card from someone else''s message'
);
SELECT throws_ok(
  $$INSERT INTO public.chat_hidden_unfurls (message_id, key) VALUES ('msg_PGTAPLPRV001', 'url:https://example.test/a')$$,
  '23505', NULL, 'a card is removed once'
);
SELECT results_eq(
  $$SELECT message_id::text, key FROM public.chat_hidden_unfurls ORDER BY message_id$$,
  $$VALUES ('msg_PGTAPLPRV001'::text, 'url:https://example.test/a'::text), ('msg_PGTAPLPRV003', 'url:https://example.test/c'), ('msg_PGTAPLPRV005', 'idx:0')$$,
  'a reader sees the removals of the messages they can read, and not those of a private channel'
);

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT 1 FROM public.chat_link_previews$$, '42501', NULL, 'a signed-out visitor cannot read previews');

RESET ROLE;
DELETE FROM public.chat_messages WHERE id = 'msg_PGTAPLPRV001';
SELECT is(
  (SELECT count(*)::int FROM public.chat_link_previews WHERE message_id = 'msg_PGTAPLPRV001') + (SELECT count(*)::int FROM public.chat_hidden_unfurls WHERE message_id = 'msg_PGTAPLPRV001'),
  0,
  'the rows go with their message'
);

SELECT * FROM finish(true);
ROLLBACK;
