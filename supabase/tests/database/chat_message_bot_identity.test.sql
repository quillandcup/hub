-- pgTAP tests for 20270617000000_chat_message_bot_identity.sql:
--  * chat_slack_bot_summary keeps the app's name and an https icon, drops anything else;
--  * projecting a Slack message from an app fills chat_message_contents.bot, and a person's message has none;
--  * a later edit that only fills in `attachments` (Slack's link preview) reaches the chat on the next projection;
--  * a member reads the bot and attachments through the same RLS as the text.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fda1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cbot-fern@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000fda1', 'cbot-fern@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000fd01', 'Bot Fern', 'cbot-fern@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('00000000-0000-4000-a000-00000000fdc1', 'channel', 'public', false, 'cbot', 'PGTAP_CB_CHAN');

SELECT is(
  public.chat_slack_bot_summary('{"bot_profile":{"name":"Deploys","icons":{"image_48":"https://example.test/i48.png","image_72":"https://example.test/i72.png"}}}'::jsonb),
  '{"name":"Deploys","icon":"https://example.test/i48.png"}'::jsonb,
  'an app is its profile name and icon'
);
SELECT is(
  public.chat_slack_bot_summary('{"username":"Reminder bot","icons":{"image_64":"http://insecure.example.test/i.png","image_48":"https://example.test/e.png"}}'::jsonb),
  '{"name":"Reminder bot","icon":"https://example.test/e.png"}'::jsonb,
  'a custom sender is its username, with only an https icon'
);
SELECT is(public.chat_slack_bot_summary('{"bot_profile":{"name":"X","icons":{"image_48":"javascript:alert(1)"}}}'::jsonb), '{"name":"X"}'::jsonb, 'a non-https icon is dropped');
SELECT is(public.chat_slack_bot_summary('{"user":"U1","text":"hi"}'::jsonb), NULL::jsonb, 'a person has none');

INSERT INTO bronze.slack_messages (message_ts, channel_id, channel_name, channel_type, user_id, text, occurred_at, raw_payload) VALUES
  ('4070908900.000200', 'PGTAP_CB_CHAN', 'cbot', 'public_channel', 'U_BOTUSER', 'Deployed', '2099-01-01T00:00:00Z',
   '{"bot_id":"B1","bot_profile":{"name":"Deploys","icons":{"image_48":"https://example.test/i48.png"}},"blocks":[{"type":"section","text":{"type":"mrkdwn","text":"*Deployed*"}}]}'),
  ('4070908900.000300', 'PGTAP_CB_CHAN', 'cbot', 'public_channel', 'U_PERSON', 'see https://example.test/a', '2099-01-01T00:00:01Z', '{}');
SELECT project_slack_chat_message('PGTAP_CB_CHAN', '4070908900.000200');
SELECT project_slack_chat_message('PGTAP_CB_CHAN', '4070908900.000300');

SELECT is(
  (SELECT c.bot->>'name' FROM chat_message_contents c JOIN chat_messages m ON m.id = c.message_id WHERE m.slack_ts = '4070908900.000200'),
  'Deploys',
  'a projected app message carries the app name'
);
SELECT is(
  (SELECT c.bot FROM chat_message_contents c JOIN chat_messages m ON m.id = c.message_id WHERE m.slack_ts = '4070908900.000300'),
  NULL::jsonb,
  'a person''s message has no bot'
);
SELECT is(
  (SELECT c.blocks->0->>'type' FROM chat_message_contents c JOIN chat_messages m ON m.id = c.message_id WHERE m.slack_ts = '4070908900.000200'),
  'section',
  'the app''s blocks are projected'
);

-- Slack adds the link preview later, in a message_changed that the webhook stores as the message's new payload.
UPDATE bronze.slack_messages
SET raw_payload = '{"attachments":[{"title":"Example","title_link":"https://example.test/a","text":"A page"}]}'::jsonb
WHERE message_ts = '4070908900.000300';
SELECT project_slack_chat_message('PGTAP_CB_CHAN', '4070908900.000300');
SELECT is(
  (SELECT c.attachments->0->>'title' FROM chat_message_contents c JOIN chat_messages m ON m.id = c.message_id WHERE m.slack_ts = '4070908900.000300'),
  'Example',
  'a later edit that only adds attachments shows up on the next projection'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fda1", "email": "cbot-fern@example.test", "role": "authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM chat_message_contents WHERE (bot IS NOT NULL OR attachments IS NOT NULL) AND message_id IN (SELECT id FROM chat_messages WHERE channel_id = '00000000-0000-4000-a000-00000000fdc1')),
  2,
  'a member reads the bot and the attachments of messages in a public channel'
);

SELECT * FROM finish(true);
ROLLBACK;
