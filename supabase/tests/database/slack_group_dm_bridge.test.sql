-- pgTAP tests for 20270610000000_slack_group_dm_bridge.sql: a group DM only a member's token reads (bronze.slack_channels.token_only)
-- is in the chat of the members who have pulled their own DMs and no one else, in the per-group projection, the full projection
-- and its closing step; a group the bot reads keeps its members from the bot's Bronze membership with no gating, whichever of
-- the bot and a member's pull recorded it first; 1:1 DMs, Hub-only DMs and normal channels are untouched.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(21);

SELECT ok(
  NOT has_function_privilege('authenticated', 'slack_group_dm_token_only(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'slack_group_dm_token_only(text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'slack_group_dm_token_only(text)', 'EXECUTE'),
  'only the service role asks whether a group is token only'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'project_slack_group_dm(text, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'project_slack_group_dm(text, jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'project_slack_group_dm(text, jsonb)', 'EXECUTE'),
  'only the service role projects a token-only group'
);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAgdA1', 'Gd Fern', 'gd-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAgdA2', 'Gd Gale', 'gd-gale@example.test', now(), 'active'),
  ('mbr_AAAAAAAAgdA3', 'Gd Hale', 'gd-hale@example.test', now(), 'active');
-- Fern has pulled; Gale is connected but has not; Hale never connected.
INSERT INTO public.member_slack_connections (member_id, slack_user_id, scopes, dms_pulled_at, revoked_at) VALUES
  ('mbr_AAAAAAAAgdA1', 'PGTAPGD_UFERN', ARRAY['mpim:history'], now(), NULL),
  ('mbr_AAAAAAAAgdA2', 'PGTAPGD_UGALE', ARRAY['mpim:history'], NULL, NULL);

-- The default: a row written the way the bot's import wrote it before the marker is not token only.
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_archived, member_count, raw_payload) VALUES
  ('PGTAPGD_GBOT', 'mpdm-bot', true, true, false, 3, '{}');
SELECT is(public.slack_group_dm_token_only('PGTAPGD_GBOT'), false, 'a group the bot recorded is not token only');
SELECT is(public.slack_group_dm_token_only('PGTAPGD_NOPE'), false, 'an unknown conversation is not token only');

-- Member first: the pull inserts it as token only (and an insert that finds it does nothing).
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_im, token_only, is_archived, member_count, raw_payload) VALUES
  ('PGTAPGD_GTOK', '', true, true, false, true, false, 3, '{}')
  ON CONFLICT (channel_id) DO NOTHING;
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_im, token_only, is_archived, member_count, raw_payload) VALUES
  ('PGTAPGD_GBOT', '', true, true, false, true, false, 3, '{}')
  ON CONFLICT (channel_id) DO NOTHING;
SELECT is(public.slack_group_dm_token_only('PGTAPGD_GTOK'), true, 'a group only a member''s pull recorded is token only');
SELECT is(public.slack_group_dm_token_only('PGTAPGD_GBOT'), false, 'the member''s pull does not mark a group the bot recorded first');

-- A 1:1 DM and a plain channel are never token only, whatever the column says.
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_im, token_only, is_archived, member_count, raw_payload) VALUES
  ('PGTAPGD_C1', 'gd-general', false, false, false, true, false, 2, '{}');
SELECT is(public.slack_group_dm_token_only('PGTAPGD_C1'), false, 'only a group DM can be token only');

INSERT INTO bronze.slack_channel_members (channel_id, user_id) VALUES
  ('PGTAPGD_GTOK', 'PGTAPGD_UFERN'), ('PGTAPGD_GTOK', 'PGTAPGD_UGALE'), ('PGTAPGD_GTOK', 'PGTAPGD_UHALE');

-- Fern's pull projects the group: only Fern, who has pulled, is in it; all three are authors.
SELECT public.project_slack_group_dm('PGTAPGD_GTOK', '{"PGTAPGD_UFERN": "mbr_AAAAAAAAgdA1", "PGTAPGD_UGALE": "mbr_AAAAAAAAgdA2", "PGTAPGD_UHALE": "mbr_AAAAAAAAgdA3"}'::jsonb);
SELECT is((SELECT kind || '/' || visibility || '/' || restricted::text || '/' || COALESCE(name, 'none') FROM public.chat_channels WHERE slack_channel_id = 'PGTAPGD_GTOK'), 'group_dm/private/true/none', 'it is a restricted, unnamed group message');
SELECT is((SELECT string_agg(m.member_id, ',' ORDER BY m.member_id) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPGD_GTOK' AND m.left_at IS NULL), 'mbr_AAAAAAAAgdA1', 'only the member who pulled is in a token-only group');
SELECT is((SELECT count(*) FROM public.chat_slack_authors WHERE slack_user_id IN ('PGTAPGD_UFERN', 'PGTAPGD_UGALE', 'PGTAPGD_UHALE')), 3::bigint, 'but each Hub member in it is matched as the author of their messages');

-- A projection of a group the bot reads is refused (the bot's projection owns it); an unknown one too.
SELECT is(public.project_slack_group_dm('PGTAPGD_GBOT', '{"PGTAPGD_UFERN": "mbr_AAAAAAAAgdA1"}'::jsonb) ->> 'channel', NULL, 'a group the bot reads is not projected by a member''s pull');
SELECT is(public.project_slack_group_dm('PGTAPGD_NOPE', '{}'::jsonb) ->> 'channel', NULL, 'nor is an unknown one');

-- Gale pulls: the next projection puts her in it.
UPDATE public.member_slack_connections SET dms_pulled_at = now() WHERE member_id = 'mbr_AAAAAAAAgdA2';
SELECT public.project_slack_group_dm('PGTAPGD_GTOK', '{"PGTAPGD_UFERN": "mbr_AAAAAAAAgdA1", "PGTAPGD_UGALE": "mbr_AAAAAAAAgdA2", "PGTAPGD_UHALE": "mbr_AAAAAAAAgdA3"}'::jsonb);
SELECT is((SELECT string_agg(m.member_id, ',' ORDER BY m.member_id) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPGD_GTOK' AND m.left_at IS NULL), 'mbr_AAAAAAAAgdA1,mbr_AAAAAAAAgdA2', 'a member who has pulled since is in it too, Hale (never connected) is not');

-- The full projection: Hale is in the group's Bronze members and is not added; the bot-read group gets everyone it lists.
INSERT INTO bronze.slack_channel_members (channel_id, user_id) VALUES
  ('PGTAPGD_GBOT', 'PGTAPGD_UFERN'), ('PGTAPGD_GBOT', 'PGTAPGD_UGALE'), ('PGTAPGD_GBOT', 'PGTAPGD_UHALE'),
  ('PGTAPGD_C1', 'PGTAPGD_UHALE');
SELECT public.project_slack_chat_channels('{"PGTAPGD_UFERN": "mbr_AAAAAAAAgdA1", "PGTAPGD_UGALE": "mbr_AAAAAAAAgdA2", "PGTAPGD_UHALE": "mbr_AAAAAAAAgdA3"}'::jsonb);
SELECT is((SELECT string_agg(m.member_id, ',' ORDER BY m.member_id) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPGD_GTOK' AND m.left_at IS NULL), 'mbr_AAAAAAAAgdA1,mbr_AAAAAAAAgdA2', 'the full projection does not add a member who has not pulled to a token-only group');
SELECT is((SELECT string_agg(m.member_id, ',' ORDER BY m.member_id) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPGD_GBOT' AND m.left_at IS NULL), 'mbr_AAAAAAAAgdA1,mbr_AAAAAAAAgdA2,mbr_AAAAAAAAgdA3', 'a group the bot reads keeps all its members, pulled or not');
SELECT is((SELECT string_agg(m.member_id, ',') FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPGD_C1' AND m.left_at IS NULL), 'mbr_AAAAAAAAgdA3', 'a normal channel is not subject to the rule, whatever its marker says');

-- Bot second: its import lists the group and writes the marker false, so from the next projection every Bronze member is in it.
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, token_only, is_archived, member_count, raw_payload)
  VALUES ('PGTAPGD_GTOK', 'mpdm-now-bot', true, true, false, false, 3, '{}')
  ON CONFLICT (channel_id) DO UPDATE SET name = EXCLUDED.name, token_only = EXCLUDED.token_only;
SELECT is(public.slack_group_dm_token_only('PGTAPGD_GTOK'), false, 'once the bot''s import lists it, the group is no longer token only');
SELECT public.project_slack_chat_channels('{"PGTAPGD_UFERN": "mbr_AAAAAAAAgdA1", "PGTAPGD_UGALE": "mbr_AAAAAAAAgdA2", "PGTAPGD_UHALE": "mbr_AAAAAAAAgdA3"}'::jsonb);
SELECT is((SELECT count(*) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPGD_GTOK' AND m.left_at IS NULL), 3::bigint, 'and the bot''s membership then applies without gating');

-- Closing: a token-only group closes the membership of a member who no longer has a working pulled connection.
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_im, token_only, is_archived, member_count, raw_payload) VALUES
  ('PGTAPGD_GTOK2', '', true, true, false, true, false, 2, '{}');
INSERT INTO bronze.slack_channel_members (channel_id, user_id) VALUES ('PGTAPGD_GTOK2', 'PGTAPGD_UFERN'), ('PGTAPGD_GTOK2', 'PGTAPGD_UHALE');
SELECT public.project_slack_group_dm('PGTAPGD_GTOK2', '{"PGTAPGD_UFERN": "mbr_AAAAAAAAgdA1", "PGTAPGD_UHALE": "mbr_AAAAAAAAgdA3"}'::jsonb);
INSERT INTO public.chat_channel_members (channel_id, member_id, source) SELECT id, 'mbr_AAAAAAAAgdA3', 'slack' FROM public.chat_channels WHERE slack_channel_id = 'PGTAPGD_GTOK2';
SELECT public.project_slack_chat_channels('{"PGTAPGD_UFERN": "mbr_AAAAAAAAgdA1", "PGTAPGD_UGALE": "mbr_AAAAAAAAgdA2", "PGTAPGD_UHALE": "mbr_AAAAAAAAgdA3"}'::jsonb);
SELECT is((SELECT string_agg(m.member_id, ',' ORDER BY m.member_id) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPGD_GTOK2' AND m.left_at IS NULL), 'mbr_AAAAAAAAgdA1', 'the full projection closes a token-only group for a member who has not pulled');

-- A 1:1 DM keeps the rule it had, and a Hub-only DM is untouched.
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_im, im_user_id, is_archived, member_count, raw_payload) VALUES
  ('PGTAPGD_D1', '', true, false, true, 'PGTAPGD_UGALE', false, 2, '{}');
INSERT INTO bronze.slack_channel_members (channel_id, user_id) VALUES ('PGTAPGD_D1', 'PGTAPGD_UFERN'), ('PGTAPGD_D1', 'PGTAPGD_UGALE'), ('PGTAPGD_D1', 'PGTAPGD_UHALE');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, bridge_mode, dm_key) VALUES ('chn_AAAAAAAAgdc1', 'dm', 'private', true, 'app_only', 'pgtap:gd');
INSERT INTO public.chat_channel_members (channel_id, member_id, source) VALUES ('chn_AAAAAAAAgdc1', 'mbr_AAAAAAAAgdA3', 'app'), ('chn_AAAAAAAAgdc1', 'mbr_AAAAAAAAgdA2', 'app');
SELECT public.project_slack_chat_channels('{"PGTAPGD_UFERN": "mbr_AAAAAAAAgdA1", "PGTAPGD_UGALE": "mbr_AAAAAAAAgdA2", "PGTAPGD_UHALE": "mbr_AAAAAAAAgdA3"}'::jsonb);
SELECT is((SELECT string_agg(m.member_id, ',' ORDER BY m.member_id) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPGD_D1' AND m.left_at IS NULL), 'mbr_AAAAAAAAgdA1,mbr_AAAAAAAAgdA2', 'a 1:1 DM is still in the chat of the members who pulled only');
SELECT is((SELECT count(*) FROM public.chat_channel_members WHERE channel_id = 'chn_AAAAAAAAgdc1' AND left_at IS NULL), 2::bigint, 'a Hub-only DM keeps its members');

SELECT * FROM finish(true);
ROLLBACK;
