-- pgTAP tests for 20270430000000_slack_dm_bridge.sql: a Slack 1:1 DM read with a member's own token becomes a
-- chat 'dm' (private, restricted, unnamed) with the Hub members among its two people, both through the
-- per-DM projection and the full one; only those two can read it and staff see that it exists but not the text;
-- the pull is claimed at most once per interval; nothing here is callable by members.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(23);

SELECT ok(NOT has_function_privilege('authenticated', 'project_slack_dm(text, jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'project_slack_dm(text, jsonb)', 'EXECUTE'), 'members cannot project a DM');
SELECT ok(has_function_privilege('service_role', 'project_slack_dm(text, jsonb)', 'EXECUTE'), 'the service role can');
SELECT ok(NOT has_function_privilege('authenticated', 'chat_claim_slack_dm_pull(text, integer)', 'EXECUTE') AND has_function_privilege('service_role', 'chat_claim_slack_dm_pull(text, integer)', 'EXECUTE'), 'only the service role claims a DM pull');
SELECT is((SELECT enabled_globally FROM public.feature_flags WHERE feature_key = 'slack_dm_bridge'), false, 'the bridge starts off for everyone');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fdb1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-fern@example.test'),
  ('00000000-0000-4000-a000-00000000fdb2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-gale@example.test'),
  ('00000000-0000-4000-a000-00000000fdb3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-hale@example.test'),
  ('00000000-0000-4000-a000-00000000fdb4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-staff@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000fdb1', 'sd-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000fdb2', 'sd-gale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000fdb3', 'sd-hale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000fdb4', 'sd-staff@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAsdA1', 'Sd Fern', 'sd-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAsdA2', 'Sd Gale', 'sd-gale@example.test', now(), 'active'),
  ('mbr_AAAAAAAAsdA3', 'Sd Hale', 'sd-hale@example.test', now(), 'active');

-- Both have pulled their DMs (a Slack DM is in the chat of the members who have; slack_dm_visibility_gate.test.sql covers who hasn't).
INSERT INTO public.member_slack_connections (member_id, slack_user_id, scopes, dms_pulled_at) VALUES
  ('mbr_AAAAAAAAsdA1', 'PGTAPSD_UFERN', ARRAY['im:history'], now()),
  ('mbr_AAAAAAAAsdA2', 'PGTAPSD_UGALE', ARRAY['im:history'], now());

-- A DM between Fern and Gale (D1), one between Fern and someone who isn't a member (D2), and a normal channel.
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_im, im_user_id, is_archived, member_count, raw_payload) VALUES
  ('PGTAPSD_D1', '', true, false, true, 'PGTAPSD_UGALE', false, 2, '{}'),
  ('PGTAPSD_D2', '', true, false, true, 'PGTAPSD_USTRANGER', false, 2, '{}'),
  ('PGTAPSD_C1', 'sd-general', false, false, false, NULL, false, 5, '{}');
INSERT INTO bronze.slack_messages (channel_id, message_ts, user_id, text, occurred_at, channel_type, raw_payload) VALUES
  ('PGTAPSD_D1', '1700000000.000100', 'PGTAPSD_UFERN', 'hello gale', now(), 'im', '{}'),
  ('PGTAPSD_D1', '1700000000.000200', 'PGTAPSD_UGALE', 'hello fern', now(), 'im', '{}');

SELECT is((SELECT channel IS NOT NULL FROM (SELECT public.project_slack_dm('PGTAPSD_D1', '{"PGTAPSD_UFERN": "mbr_AAAAAAAAsdA1", "PGTAPSD_UGALE": "mbr_AAAAAAAAsdA2"}'::jsonb)->>'channel' AS channel) x), true, 'a DM is projected');
SELECT is((SELECT kind || '/' || visibility || '/' || restricted || '/' || bridge_mode || '/' || COALESCE(name, 'unnamed') FROM public.chat_channels WHERE slack_channel_id = 'PGTAPSD_D1'), 'dm/private/true/bridged/unnamed', 'as a private, restricted, unnamed, bridged direct message');
SELECT is((SELECT count(*) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPSD_D1' AND m.left_at IS NULL), 2::bigint, 'with both Hub members in it');
SELECT is((SELECT count(*) FROM public.chat_slack_authors WHERE slack_user_id IN ('PGTAPSD_UFERN', 'PGTAPSD_UGALE')), 2::bigint, 'and both Slack ids matched to their members for the messages');
SELECT is(public.project_slack_dm('PGTAPSD_D1', '{"PGTAPSD_UFERN": "mbr_AAAAAAAAsdA1", "PGTAPSD_UGALE": "mbr_AAAAAAAAsdA2"}'::jsonb)->>'channel', (SELECT id FROM public.chat_channels WHERE slack_channel_id = 'PGTAPSD_D1'), 'projecting again finds the same conversation');
SELECT is(public.project_slack_dm('PGTAPSD_C1', '{"PGTAPSD_UFERN": "mbr_AAAAAAAAsdA1"}'::jsonb)->>'channel', NULL, 'a channel that is not a DM is left alone');
SELECT is((SELECT count(*) FROM public.chat_channels WHERE slack_channel_id = 'PGTAPSD_C1'), 0::bigint, 'and is not projected by this');
SELECT is((public.project_slack_dm('PGTAPSD_D2', '{"PGTAPSD_UFERN": "mbr_AAAAAAAAsdA1"}'::jsonb)->>'channel') IS NOT NULL, true, 'a DM with someone who is not a member is projected for the member');
SELECT is((SELECT count(*) FROM public.chat_channel_members m JOIN public.chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPSD_D2'), 1::bigint, 'with only the member in it');

-- A member who left comes back when their DM is projected again.
UPDATE public.chat_channel_members SET left_at = now() WHERE member_id = 'mbr_AAAAAAAAsdA2' AND channel_id = (SELECT id FROM public.chat_channels WHERE slack_channel_id = 'PGTAPSD_D1');
SELECT public.project_slack_dm('PGTAPSD_D1', '{"PGTAPSD_UFERN": "mbr_AAAAAAAAsdA1", "PGTAPSD_UGALE": "mbr_AAAAAAAAsdA2"}'::jsonb);
SELECT is((SELECT left_at IS NULL FROM public.chat_channel_members WHERE member_id = 'mbr_AAAAAAAAsdA2' AND channel_id = (SELECT id FROM public.chat_channels WHERE slack_channel_id = 'PGTAPSD_D1')), true, 'projecting again brings back a member marked as left');

-- The messages go in one at a time, as the webhook does.
SELECT public.project_slack_chat_message('PGTAPSD_D1', '1700000000.000100');
SELECT public.project_slack_chat_message('PGTAPSD_D1', '1700000000.000200');
SELECT is((SELECT string_agg(COALESCE(m.author_member_id, '-') || ':' || c.body, '|' ORDER BY m.slack_ts) FROM public.chat_messages m JOIN public.chat_message_contents c ON c.message_id = m.id JOIN public.chat_channels ch ON ch.id = m.channel_id WHERE ch.slack_channel_id = 'PGTAPSD_D1'), 'mbr_AAAAAAAAsdA1:hello gale|mbr_AAAAAAAAsdA2:hello fern', 'the messages are in with their authors');

-- The full projection treats a DM the same way, and still names and files a channel as before.
SELECT public.project_slack_chat_channels('{"PGTAPSD_UFERN": "mbr_AAAAAAAAsdA1", "PGTAPSD_UGALE": "mbr_AAAAAAAAsdA2"}'::jsonb);
SELECT is((SELECT string_agg(slack_channel_id || '=' || kind || '/' || restricted || '/' || COALESCE(name, '-'), ',' ORDER BY slack_channel_id) FROM public.chat_channels WHERE slack_channel_id LIKE 'PGTAPSD_%'), 'PGTAPSD_C1=channel/false/sd-general,PGTAPSD_D1=dm/true/-,PGTAPSD_D2=dm/true/-', 'the full projection files DMs as private direct messages and a channel as a channel');

-- Claiming a pull: once, then not until the interval is over; never for a member without a working connection.
UPDATE public.member_slack_connections SET dms_pulled_at = NULL WHERE member_id = 'mbr_AAAAAAAAsdA1';
SELECT is(public.chat_claim_slack_dm_pull('mbr_AAAAAAAAsdA1', 300), true, 'the first pull is claimed');
SELECT is(public.chat_claim_slack_dm_pull('mbr_AAAAAAAAsdA1', 300), false, 'a second one a moment later is not');
UPDATE public.member_slack_connections SET dms_pulled_at = now() - interval '10 minutes' WHERE member_id = 'mbr_AAAAAAAAsdA1';
SELECT is(public.chat_claim_slack_dm_pull('mbr_AAAAAAAAsdA1', 300), true, 'a pull after the interval is');
SELECT is(public.chat_claim_slack_dm_pull('mbr_AAAAAAAAsdA3', 300), false, 'a member who never connected Slack is not');

-- Who can see it: its two people read it; a third member sees nothing; staff see that it exists, never the text.
CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT, SELECT ON result TO authenticated;
CREATE FUNCTION public.pgtap_try(p_label text, p_sql text) RETURNS void AS $$
BEGIN
  EXECUTE format('INSERT INTO result SELECT %L, (%s)::text', p_label, p_sql);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (p_label, SQLERRM);
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.pgtap_try(text, text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fdb2", "email": "sd-gale@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try('gale reads', $$ SELECT count(*) FROM chat_message_contents WHERE message_id IN (SELECT m.id FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id = 'PGTAPSD_D1') $$);
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fdb3", "email": "sd-hale@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try('hale sees', $$ SELECT (SELECT count(*) FROM chat_channels WHERE slack_channel_id LIKE 'PGTAPSD_D%') || '/' || (SELECT count(*) FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id LIKE 'PGTAPSD_D%') $$);
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fdb4", "email": "sd-staff@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try('staff sees', $$ SELECT (SELECT count(*) FROM chat_channels WHERE slack_channel_id LIKE 'PGTAPSD_D%') || '/' || (SELECT count(*) FROM chat_message_contents WHERE message_id IN (SELECT m.id FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE c.slack_channel_id LIKE 'PGTAPSD_D%')) $$);
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'gale reads'), '2', 'the other person reads the DM');
SELECT is((SELECT value FROM result WHERE label = 'hale sees'), '0/0', 'a third member sees neither the DMs nor their messages');
SELECT is((SELECT value FROM result WHERE label = 'staff sees'), '2/0', 'staff see both conversations exist, and read none of the text');

SELECT * FROM finish(true);
ROLLBACK;
