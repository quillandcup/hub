-- pgTAP tests for 20270613000000_chat_dm_counterparts.sql: the names of the other people in a member's own Slack DMs
-- (and in group DMs only members' tokens read), for the sidebar's labels: a matched Hub member by display name, anyone else
-- by Slack name; never the viewer, a bot, someone who left, a bot-read group, a Hub-only DM or a channel; a member can ask
-- only for themselves, the service role for anyone.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(10);

SELECT ok(NOT has_function_privilege('anon', 'chat_dm_counterparts(text)', 'EXECUTE') AND has_function_privilege('authenticated', 'chat_dm_counterparts(text)', 'EXECUTE'), 'signed-in members can ask, signed-out visitors cannot');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fdc1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dc-fern@example.test'),
  ('00000000-0000-4000-a000-00000000fdc2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dc-gale@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000fdc1', 'dc-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000fdc2', 'dc-gale@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, display_name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAdcA1', 'Dc Fern Legal', 'Dc Fern', 'dc-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAdcA2', 'Dc Gale Legal', 'Dc Gale', 'dc-gale@example.test', now(), 'active'),
  ('mbr_AAAAAAAAdcA3', 'Dc Hale Legal', NULL, 'dc-hale@example.test', now(), 'active');
INSERT INTO public.chat_slack_authors (slack_user_id, member_id) VALUES
  ('PGTAPDC_UFERN', 'mbr_AAAAAAAAdcA1'), ('PGTAPDC_UGALE', 'mbr_AAAAAAAAdcA2'), ('PGTAPDC_UHALE', 'mbr_AAAAAAAAdcA3');
INSERT INTO bronze.slack_users (user_id, name, real_name, is_bot, raw_payload) VALUES
  ('PGTAPDC_USTRANGER', 'stella', 'Stella Stranger', false, '{}'),
  ('PGTAPDC_UBOT', 'billie', 'Billie Bot', true, '{}');

-- D1 with Gale (matched), D2 with a stranger, T1 a group only tokens read (Gale, Hale, the bot, and Zed who left),
-- B1 a group the bot reads, C1 a channel, and a Hub-only DM; Fern is in all of them.
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_im, token_only, is_archived, member_count, raw_payload) VALUES
  ('PGTAPDC_D1', '', true, false, true, false, false, 2, '{}'),
  ('PGTAPDC_D2', '', true, false, true, false, false, 2, '{}'),
  ('PGTAPDC_T1', '', true, true, false, true, false, 4, '{}'),
  ('PGTAPDC_B1', '', true, true, false, false, false, 3, '{}'),
  ('PGTAPDC_C1', 'dc-general', false, false, false, false, false, 3, '{}');
INSERT INTO bronze.slack_channel_members (channel_id, user_id, left_at) VALUES
  ('PGTAPDC_D1', 'PGTAPDC_UFERN', NULL), ('PGTAPDC_D1', 'PGTAPDC_UGALE', NULL),
  ('PGTAPDC_D2', 'PGTAPDC_UFERN', NULL), ('PGTAPDC_D2', 'PGTAPDC_USTRANGER', NULL), ('PGTAPDC_D2', 'PGTAPDC_UBOT', NULL),
  ('PGTAPDC_T1', 'PGTAPDC_UFERN', NULL), ('PGTAPDC_T1', 'PGTAPDC_UGALE', NULL), ('PGTAPDC_T1', 'PGTAPDC_UHALE', NULL), ('PGTAPDC_T1', 'PGTAPDC_USTRANGER', now()),
  ('PGTAPDC_B1', 'PGTAPDC_UFERN', NULL), ('PGTAPDC_B1', 'PGTAPDC_UGALE', NULL),
  ('PGTAPDC_C1', 'PGTAPDC_UFERN', NULL), ('PGTAPDC_C1', 'PGTAPDC_UGALE', NULL);
INSERT INTO public.chat_channels (id, kind, visibility, restricted, bridge_mode, slack_channel_id) VALUES
  ('chn_AAAAAAAAdcc1', 'dm', 'private', true, 'bridged', 'PGTAPDC_D1'),
  ('chn_AAAAAAAAdcc2', 'dm', 'private', true, 'bridged', 'PGTAPDC_D2'),
  ('chn_AAAAAAAAdcc3', 'group_dm', 'private', true, 'bridged', 'PGTAPDC_T1'),
  ('chn_AAAAAAAAdcc4', 'group_dm', 'private', true, 'bridged', 'PGTAPDC_B1'),
  ('chn_AAAAAAAAdcc5', 'channel', 'public', false, 'bridged', 'PGTAPDC_C1'),
  ('chn_AAAAAAAAdcc6', 'dm', 'private', true, 'app_only', NULL);
INSERT INTO public.chat_channel_members (channel_id, member_id, source) VALUES
  ('chn_AAAAAAAAdcc1', 'mbr_AAAAAAAAdcA1', 'slack'), ('chn_AAAAAAAAdcc2', 'mbr_AAAAAAAAdcA1', 'slack'),
  ('chn_AAAAAAAAdcc3', 'mbr_AAAAAAAAdcA1', 'slack'), ('chn_AAAAAAAAdcc4', 'mbr_AAAAAAAAdcA1', 'slack'),
  ('chn_AAAAAAAAdcc5', 'mbr_AAAAAAAAdcA1', 'slack'), ('chn_AAAAAAAAdcc6', 'mbr_AAAAAAAAdcA1', 'app');

CREATE TEMP TABLE result(label text, channel_id text, name text) ON COMMIT DROP;
GRANT INSERT, SELECT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fdc1", "email": "dc-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'fern', channel_id, name FROM public.chat_dm_counterparts('mbr_AAAAAAAAdcA1');
INSERT INTO result SELECT 'fern asks for gale', channel_id, name FROM public.chat_dm_counterparts('mbr_AAAAAAAAdcA2');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
INSERT INTO result SELECT 'service', channel_id, name FROM public.chat_dm_counterparts('mbr_AAAAAAAAdcA1');
SELECT set_config('request.jwt.claims', '', true);

SELECT is((SELECT name FROM result WHERE label = 'fern' AND channel_id = 'chn_AAAAAAAAdcc1'), 'Dc Gale', 'a DM is named after the other person by their Hub display name, not their legal name');
SELECT is((SELECT name FROM result WHERE label = 'fern' AND channel_id = 'chn_AAAAAAAAdcc2'), 'Stella Stranger', 'a DM with someone who is not a member by their Slack name, the bot left out');
SELECT is((SELECT string_agg(name, ', ' ORDER BY name) FROM result WHERE label = 'fern' AND channel_id = 'chn_AAAAAAAAdcc3'), 'Dc Gale, Dc Hale Legal', 'a group only tokens read lists everyone but the viewer, by display name else name, and not who left');
SELECT is((SELECT count(*) FROM result WHERE label = 'fern' AND channel_id IN ('chn_AAAAAAAAdcc4', 'chn_AAAAAAAAdcc5', 'chn_AAAAAAAAdcc6')), 0::bigint, 'a group the bot reads, a channel and a Hub-only DM are not named here');
SELECT is((SELECT count(*) FROM result WHERE label = 'fern' AND name LIKE 'Dc Fern%'), 0::bigint, 'the viewer is never named');
SELECT is((SELECT count(*) FROM result WHERE label = 'fern asks for gale'), 0::bigint, 'a member cannot ask for someone else''s');
SELECT is((SELECT count(*) FROM result WHERE label = 'service'), 4::bigint, 'the service role can ask for anyone''s');
SELECT is((SELECT count(DISTINCT channel_id) FROM result WHERE label = 'service'), 3::bigint, 'across their three Slack conversations');
SELECT is((SELECT count(*) FROM public.chat_dm_counterparts('mbr_AAAAAAAAdcA1')), 0::bigint, 'and with no one signed in, nothing');

SELECT * FROM finish(true);
ROLLBACK;
