-- pgTAP tests for 20270603000000_slack_dm_visibility_gate.sql: a pulled Slack DM is in the chat of the members who have
-- pulled their own DMs, and not of the other person just for being in it; the full projection and its closing step
-- follow the same rule; a disconnected member loses it; a Hub-only DM is untouched.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(12);

SELECT ok(NOT has_function_privilege('authenticated', 'slack_dm_member_pulled(text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'slack_dm_member_pulled(text)', 'EXECUTE') AND has_function_privilege('service_role', 'slack_dm_member_pulled(text)', 'EXECUTE'), 'only the service role asks whether a member has pulled');

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAvgA1', 'Vg Fern', 'vg-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAvgA2', 'Vg Gale', 'vg-gale@example.test', now(), 'active'),
  ('mbr_AAAAAAAAvgA3', 'Vg Hale', 'vg-hale@example.test', now(), 'active'),
  ('mbr_AAAAAAAAvgA4', 'Vg Ivy', 'vg-ivy@example.test', now(), 'active');
-- Fern has pulled; Gale is connected but has not; Hale pulled but her connection was revoked; Ivy never connected.
INSERT INTO public.member_slack_connections (member_id, slack_user_id, scopes, dms_pulled_at, revoked_at) VALUES
  ('mbr_AAAAAAAAvgA1', 'PGTAPVG_UFERN', ARRAY['im:history'], now(), NULL),
  ('mbr_AAAAAAAAvgA2', 'PGTAPVG_UGALE', ARRAY['im:history'], NULL, NULL),
  ('mbr_AAAAAAAAvgA3', 'PGTAPVG_UHALE', ARRAY['im:history'], now(), now());

SELECT is(
  (SELECT string_agg(m || '=' || public.slack_dm_member_pulled(m)::text, ',' ORDER BY m) FROM unnest(ARRAY['mbr_AAAAAAAAvgA1', 'mbr_AAAAAAAAvgA2', 'mbr_AAAAAAAAvgA3', 'mbr_AAAAAAAAvgA4']) m),
  'mbr_AAAAAAAAvgA1=true,mbr_AAAAAAAAvgA2=false,mbr_AAAAAAAAvgA3=false,mbr_AAAAAAAAvgA4=false',
  'a member has pulled only with a working connection that has been pulled at least once'
);

INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_im, im_user_id, is_archived, member_count, raw_payload) VALUES
  ('PGTAPVG_D1', '', true, false, true, 'PGTAPVG_UGALE', false, 2, '{}');
INSERT INTO bronze.slack_channel_members (channel_id, user_id) VALUES
  ('PGTAPVG_D1', 'PGTAPVG_UFERN'), ('PGTAPVG_D1', 'PGTAPVG_UGALE');

-- Fern's pull projects the DM with Gale: only Fern is in it, though both are authors of their messages.
SELECT public.project_slack_dm('PGTAPVG_D1', '{"PGTAPVG_UFERN": "mbr_AAAAAAAAvgA1", "PGTAPVG_UGALE": "mbr_AAAAAAAAvgA2"}'::jsonb);
SELECT is((SELECT string_agg(m.member_id, ',' ORDER BY m.member_id) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPVG_D1' AND m.left_at IS NULL), 'mbr_AAAAAAAAvgA1', 'a pulled DM is in the chat of the member who pulled it, not of the other person');
SELECT is((SELECT count(*) FROM public.chat_slack_authors WHERE slack_user_id IN ('PGTAPVG_UFERN', 'PGTAPVG_UGALE')), 2::bigint, 'but both are matched as the authors of their messages');

-- Gale pulls (a pull stamps her connection): the next projection puts her in it.
UPDATE public.member_slack_connections SET dms_pulled_at = now() WHERE member_id = 'mbr_AAAAAAAAvgA2';
SELECT public.project_slack_dm('PGTAPVG_D1', '{"PGTAPVG_UFERN": "mbr_AAAAAAAAvgA1", "PGTAPVG_UGALE": "mbr_AAAAAAAAvgA2"}'::jsonb);
SELECT is((SELECT string_agg(m.member_id, ',' ORDER BY m.member_id) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPVG_D1' AND m.left_at IS NULL), 'mbr_AAAAAAAAvgA1,mbr_AAAAAAAAvgA2', 'once the other person has pulled their own DMs they are in it too');

-- The full projection: Hale (revoked) and Ivy (never connected) are in the DM's Bronze members too, and are not put in it.
INSERT INTO bronze.slack_channel_members (channel_id, user_id) VALUES ('PGTAPVG_D1', 'PGTAPVG_UHALE'), ('PGTAPVG_D1', 'PGTAPVG_UIVY');
SELECT public.project_slack_chat_channels('{"PGTAPVG_UFERN": "mbr_AAAAAAAAvgA1", "PGTAPVG_UGALE": "mbr_AAAAAAAAvgA2", "PGTAPVG_UHALE": "mbr_AAAAAAAAvgA3", "PGTAPVG_UIVY": "mbr_AAAAAAAAvgA4"}'::jsonb);
SELECT is((SELECT string_agg(m.member_id, ',' ORDER BY m.member_id) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPVG_D1' AND m.left_at IS NULL), 'mbr_AAAAAAAAvgA1,mbr_AAAAAAAAvgA2', 'the full projection does not add a member who has not pulled');

-- ...and closes one it finds (as it would after the member's connection is revoked, or a membership from before this rule).
INSERT INTO public.chat_channel_members (channel_id, member_id, source) SELECT id, 'mbr_AAAAAAAAvgA4', 'slack' FROM public.chat_channels WHERE slack_channel_id = 'PGTAPVG_D1';
UPDATE public.member_slack_connections SET revoked_at = now() WHERE member_id = 'mbr_AAAAAAAAvgA2';
SELECT public.project_slack_chat_channels('{"PGTAPVG_UFERN": "mbr_AAAAAAAAvgA1", "PGTAPVG_UGALE": "mbr_AAAAAAAAvgA2", "PGTAPVG_UHALE": "mbr_AAAAAAAAvgA3", "PGTAPVG_UIVY": "mbr_AAAAAAAAvgA4"}'::jsonb);
SELECT is((SELECT string_agg(m.member_id, ',' ORDER BY m.member_id) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPVG_D1' AND m.left_at IS NULL), 'mbr_AAAAAAAAvgA1', 'the full projection closes the DM for a member who has not pulled, and for one whose connection was revoked');
SELECT is((SELECT count(*) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPVG_D1' AND m.left_at IS NOT NULL), 2::bigint, 'two memberships were closed');

-- A reconnected member who pulls again is back in it.
UPDATE public.member_slack_connections SET revoked_at = NULL WHERE member_id = 'mbr_AAAAAAAAvgA2';
SELECT public.project_slack_dm('PGTAPVG_D1', '{"PGTAPVG_UFERN": "mbr_AAAAAAAAvgA1", "PGTAPVG_UGALE": "mbr_AAAAAAAAvgA2"}'::jsonb);
SELECT is((SELECT count(*) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPVG_D1' AND m.left_at IS NULL), 2::bigint, 'a member who reconnects and pulls again is back in the DM');

-- A Hub-only DM (no Slack channel, members added by the app, who have never connected Slack) is not touched.
INSERT INTO public.chat_channels (id, kind, visibility, restricted, bridge_mode, dm_key) VALUES ('chn_AAAAAAAAvgc1', 'dm', 'private', true, 'app_only', 'pgtap:vg');
INSERT INTO public.chat_channel_members (channel_id, member_id, source) VALUES ('chn_AAAAAAAAvgc1', 'mbr_AAAAAAAAvgA3', 'app'), ('chn_AAAAAAAAvgc1', 'mbr_AAAAAAAAvgA4', 'app');
SELECT public.project_slack_chat_channels('{"PGTAPVG_UFERN": "mbr_AAAAAAAAvgA1"}'::jsonb);
SELECT is((SELECT count(*) FROM public.chat_channel_members WHERE channel_id = 'chn_AAAAAAAAvgc1' AND left_at IS NULL), 2::bigint, 'a Hub-only DM keeps its members');

-- A channel is unaffected: a member of a normal channel who has never connected Slack keeps it.
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_im, is_archived, member_count, raw_payload) VALUES ('PGTAPVG_C1', 'vg-general', false, false, false, false, 2, '{}');
INSERT INTO bronze.slack_channel_members (channel_id, user_id) VALUES ('PGTAPVG_C1', 'PGTAPVG_UIVY');
SELECT public.project_slack_chat_channels('{"PGTAPVG_UFERN": "mbr_AAAAAAAAvgA1", "PGTAPVG_UGALE": "mbr_AAAAAAAAvgA2", "PGTAPVG_UIVY": "mbr_AAAAAAAAvgA4"}'::jsonb);
SELECT is((SELECT string_agg(m.member_id, ',') FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPVG_C1' AND m.left_at IS NULL), 'mbr_AAAAAAAAvgA4', 'a normal channel is not subject to the rule');
SELECT is((SELECT count(*) FROM public.chat_channels WHERE slack_channel_id = 'PGTAPVG_D1' AND kind = 'dm'), 1::bigint, 'and the DM is still one conversation');

SELECT * FROM finish(true);
ROLLBACK;
