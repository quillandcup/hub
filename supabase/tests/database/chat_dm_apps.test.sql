-- pgTAP tests for 20270728000000_chat_dm_apps.sql: which of a member's own Slack DMs are with an app (a bot and nobody
-- else), and the app's name; never a DM with a person (even with a bot in it), a group, a channel or a bot that left;
-- a member can ask only for themselves, the service role for anyone.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

SELECT ok(NOT has_function_privilege('anon', 'chat_dm_apps(text)', 'EXECUTE') AND has_function_privilege('authenticated', 'chat_dm_apps(text)', 'EXECUTE'), 'signed-in members can ask, signed-out visitors cannot');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fda1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da-fern@example.test'),
  ('00000000-0000-4000-a000-00000000fda2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da-gale@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000fda1', 'da-fern@example.test'),
  ('00000000-0000-4000-a000-00000000fda2', 'da-gale@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.members (id, name, display_name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAdaA1', 'Da Fern Legal', 'Da Fern', 'da-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAdaA2', 'Da Gale Legal', 'Da Gale', 'da-gale@example.test', now(), 'active');
INSERT INTO public.chat_slack_authors (slack_user_id, member_id) VALUES
  ('PGTAPDA_UFERN', 'mbr_AAAAAAAAdaA1'), ('PGTAPDA_UGALE', 'mbr_AAAAAAAAdaA2');
INSERT INTO bronze.slack_users (user_id, name, real_name, is_bot, raw_payload) VALUES
  ('PGTAPDA_UBOT', 'billie', 'Da Billie Bot', true, '{}');

-- D1 with the bot only, D2 with Gale and the bot, D3 with Gale, D4 with the bot after it left, C1 a channel with the bot.
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_im, token_only, is_archived, member_count, raw_payload) VALUES
  ('PGTAPDA_D1', '', true, false, true, false, false, 2, '{}'),
  ('PGTAPDA_D2', '', true, false, true, false, false, 3, '{}'),
  ('PGTAPDA_D3', '', true, false, true, false, false, 2, '{}'),
  ('PGTAPDA_D4', '', true, false, true, false, false, 1, '{}'),
  ('PGTAPDA_C1', 'da-general', false, false, false, false, false, 2, '{}');
INSERT INTO bronze.slack_channel_members (channel_id, user_id, left_at) VALUES
  ('PGTAPDA_D1', 'PGTAPDA_UFERN', NULL), ('PGTAPDA_D1', 'PGTAPDA_UBOT', NULL),
  ('PGTAPDA_D2', 'PGTAPDA_UFERN', NULL), ('PGTAPDA_D2', 'PGTAPDA_UGALE', NULL), ('PGTAPDA_D2', 'PGTAPDA_UBOT', NULL),
  ('PGTAPDA_D3', 'PGTAPDA_UFERN', NULL), ('PGTAPDA_D3', 'PGTAPDA_UGALE', NULL),
  ('PGTAPDA_D4', 'PGTAPDA_UFERN', NULL), ('PGTAPDA_D4', 'PGTAPDA_UBOT', now()),
  ('PGTAPDA_C1', 'PGTAPDA_UFERN', NULL), ('PGTAPDA_C1', 'PGTAPDA_UBOT', NULL);
INSERT INTO public.chat_channels (id, kind, visibility, restricted, bridge_mode, slack_channel_id) VALUES
  ('chn_AAAAAAAAdaa1', 'dm', 'private', true, 'bridged', 'PGTAPDA_D1'),
  ('chn_AAAAAAAAdaa2', 'dm', 'private', true, 'bridged', 'PGTAPDA_D2'),
  ('chn_AAAAAAAAdaa3', 'dm', 'private', true, 'bridged', 'PGTAPDA_D3'),
  ('chn_AAAAAAAAdaa4', 'dm', 'private', true, 'bridged', 'PGTAPDA_D4'),
  ('chn_AAAAAAAAdaa5', 'channel', 'public', false, 'bridged', 'PGTAPDA_C1');
INSERT INTO public.chat_channel_members (channel_id, member_id, source) VALUES
  ('chn_AAAAAAAAdaa1', 'mbr_AAAAAAAAdaA1', 'slack'), ('chn_AAAAAAAAdaa2', 'mbr_AAAAAAAAdaA1', 'slack'),
  ('chn_AAAAAAAAdaa3', 'mbr_AAAAAAAAdaA1', 'slack'), ('chn_AAAAAAAAdaa4', 'mbr_AAAAAAAAdaA1', 'slack'),
  ('chn_AAAAAAAAdaa5', 'mbr_AAAAAAAAdaA1', 'slack');

CREATE TEMP TABLE result(label text, channel_id text, name text) ON COMMIT DROP;
GRANT INSERT, SELECT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fda1", "email": "da-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'fern', channel_id, name FROM public.chat_dm_apps('mbr_AAAAAAAAdaA1');
INSERT INTO result SELECT 'fern asks for gale', channel_id, name FROM public.chat_dm_apps('mbr_AAAAAAAAdaA2');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
INSERT INTO result SELECT 'service', channel_id, name FROM public.chat_dm_apps('mbr_AAAAAAAAdaA1');
SELECT set_config('request.jwt.claims', '', true);

SELECT is((SELECT name FROM result WHERE label = 'fern' AND channel_id = 'chn_AAAAAAAAdaa1'), 'Da Billie Bot', 'a DM with only an app is named after the app');
SELECT is((SELECT count(*) FROM result WHERE label = 'fern' AND channel_id = 'chn_AAAAAAAAdaa2'), 0::bigint, 'a DM with a person is not an app''s, even with the bot in it');
SELECT is((SELECT count(*) FROM result WHERE label = 'fern' AND channel_id IN ('chn_AAAAAAAAdaa3', 'chn_AAAAAAAAdaa4', 'chn_AAAAAAAAdaa5')), 0::bigint, 'a DM with a person, one whose bot left, and a channel are not apps');
SELECT is((SELECT count(*) FROM result WHERE label = 'fern'), 1::bigint, 'so the member has one app');
SELECT is((SELECT count(*) FROM result WHERE label = 'fern asks for gale'), 0::bigint, 'a member cannot ask for someone else''s');
SELECT is((SELECT count(*) FROM result WHERE label = 'service'), 1::bigint, 'the service role can ask for anyone''s');
SELECT is((SELECT count(*) FROM public.chat_dm_apps('mbr_AAAAAAAAdaA1')), 0::bigint, 'and with no one signed in, nothing');

SELECT * FROM finish(true);
ROLLBACK;
