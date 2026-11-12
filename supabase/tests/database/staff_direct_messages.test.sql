-- pgTAP test for 20270705000000_staff_direct_messages_readable_by_team.sql: a direct or group message with a staff
-- member in it is readable by every admin and community manager without break-glass access; one with no staff member
-- in it is as before. Also the one definition of a staff member, the "includes staff" answer for Hub Chat's notice, and
-- the audit entry for a read by someone who is not in the conversation. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(40);

-- People: Fern and Gale and Orla are plain members (Orla is in none of the conversations); Stella is linked in the
-- staff table (no account); Ada is an admin with a member record; Boris is an admin account with no member record; Cleo
-- is a community manager with a member record; Ines has an `assistant` account (not staff for this rule).
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e5d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-fern@example.test'),
  ('00000000-0000-4000-a000-00000000e5d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-gale@example.test'),
  ('00000000-0000-4000-a000-00000000e5d3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-ada@example.test'),
  ('00000000-0000-4000-a000-00000000e5d4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-boris@example.test'),
  ('00000000-0000-4000-a000-00000000e5d5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-cleo@example.test'),
  ('00000000-0000-4000-a000-00000000e5d6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-orla@example.test'),
  ('00000000-0000-4000-a000-00000000e5d7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sd-ines@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e5d1', 'sd-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e5d2', 'sd-gale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e5d3', 'sd-ada@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000e5d4', 'sd-boris@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000e5d5', 'sd-cleo@example.test', 'community_manager'),
  ('00000000-0000-4000-a000-00000000e5d6', 'sd-orla@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e5d7', 'sd-ines@example.test', 'assistant')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_SDAAAAAAAAF1', 'Sd Fern', 'sd-fern@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d1'),
  ('mbr_SDAAAAAAAAG1', 'Sd Gale', 'sd-gale@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d2'),
  ('mbr_SDAAAAAAAAS1', 'Sd Stella', 'sd-stella@example.test', now(), 'active', NULL),
  ('mbr_SDAAAAAAAAA1', 'Sd Ada', 'sd-ada@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d3'),
  ('mbr_SDAAAAAAAAC1', 'Sd Cleo', 'sd-cleo@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d5'),
  ('mbr_SDAAAAAAAAO1', 'Sd Orla', 'sd-orla@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d6'),
  ('mbr_SDAAAAAAAAI1', 'Sd Ines', 'sd-ines@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d7');
INSERT INTO public.staff (name, email, role, member_id) VALUES ('Sd Stella', 'sd-stella@example.test', 'staff', 'mbr_SDAAAAAAAAS1');

-- Slack side of the Slack DM between Fern and Ada: Slack lists both, Ada has not pulled so she is not in the chat's list.
INSERT INTO public.chat_slack_authors (slack_user_id, member_id) VALUES
  ('SD_UFERN', 'mbr_SDAAAAAAAAF1'), ('SD_UADA', 'mbr_SDAAAAAAAAA1'), ('SD_UGALE', 'mbr_SDAAAAAAAAG1');
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, is_im, token_only, is_archived, member_count, raw_payload) VALUES
  ('SD_D3', '', true, false, true, false, false, 2, '{}'),
  ('SD_D6', '', true, false, true, false, false, 2, '{}');
INSERT INTO bronze.slack_channel_members (channel_id, user_id, left_at) VALUES
  ('SD_D3', 'SD_UFERN', NULL), ('SD_D3', 'SD_UADA', NULL),
  ('SD_D6', 'SD_UFERN', NULL), ('SD_D6', 'SD_UGALE', NULL);

-- 1 Hub DM Fern-Stella (staff table), 2 Hub DM Fern-Gale (no staff), 3 Slack DM Fern-Ada (Ada only in Slack's list),
-- 4 group DM Fern, Gale, Cleo, 5 group DM Fern, Gale (no staff), 6 Slack DM Fern-Gale (no staff), 7 group DM where the
-- staff member (Ada) has left, 8 a public channel with Ada in it, 9 Hub DM Fern-Ines (assistant: not staff).
INSERT INTO public.chat_channels (id, kind, visibility, restricted, bridge_mode, slack_channel_id) VALUES
  ('chn_SDDM00000001', 'dm', 'private', true, 'app_only', NULL),
  ('chn_SDDM00000002', 'dm', 'private', true, 'app_only', NULL),
  ('chn_SDDM00000003', 'dm', 'private', true, 'bridged', 'SD_D3'),
  ('chn_SDGRP0000004', 'group_dm', 'private', true, 'bridged', NULL),
  ('chn_SDGRP0000005', 'group_dm', 'private', true, 'bridged', NULL),
  ('chn_SDDM00000006', 'dm', 'private', true, 'bridged', 'SD_D6'),
  ('chn_SDGRP0000007', 'group_dm', 'private', true, 'bridged', NULL),
  ('chn_SDPUB0000008', 'channel', 'public', false, 'bridged', NULL),
  ('chn_SDDM00000009', 'dm', 'private', true, 'app_only', NULL);
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES
  ('chn_SDDM00000001', 'mbr_SDAAAAAAAAF1'), ('chn_SDDM00000001', 'mbr_SDAAAAAAAAS1'),
  ('chn_SDDM00000002', 'mbr_SDAAAAAAAAF1'), ('chn_SDDM00000002', 'mbr_SDAAAAAAAAG1'),
  ('chn_SDDM00000003', 'mbr_SDAAAAAAAAF1'),
  ('chn_SDGRP0000004', 'mbr_SDAAAAAAAAF1'), ('chn_SDGRP0000004', 'mbr_SDAAAAAAAAG1'), ('chn_SDGRP0000004', 'mbr_SDAAAAAAAAC1'),
  ('chn_SDGRP0000005', 'mbr_SDAAAAAAAAF1'), ('chn_SDGRP0000005', 'mbr_SDAAAAAAAAG1'),
  ('chn_SDDM00000006', 'mbr_SDAAAAAAAAF1'),
  ('chn_SDGRP0000007', 'mbr_SDAAAAAAAAF1'), ('chn_SDGRP0000007', 'mbr_SDAAAAAAAAG1'),
  ('chn_SDPUB0000008', 'mbr_SDAAAAAAAAF1'), ('chn_SDPUB0000008', 'mbr_SDAAAAAAAAA1'),
  ('chn_SDDM00000009', 'mbr_SDAAAAAAAAF1'), ('chn_SDDM00000009', 'mbr_SDAAAAAAAAI1');
INSERT INTO public.chat_channel_members (channel_id, member_id, left_at) VALUES
  ('chn_SDGRP0000007', 'mbr_SDAAAAAAAAA1', now());

INSERT INTO public.chat_messages (id, channel_id, created_at) VALUES
  ('msg_SDM000000001', 'chn_SDDM00000001', now()), ('msg_SDM000000002', 'chn_SDDM00000002', now()),
  ('msg_SDM000000003', 'chn_SDDM00000003', now()), ('msg_SDM000000004', 'chn_SDGRP0000004', now()),
  ('msg_SDM000000005', 'chn_SDGRP0000005', now()), ('msg_SDM000000006', 'chn_SDDM00000006', now()),
  ('msg_SDM000000007', 'chn_SDGRP0000007', now()), ('msg_SDM000000008', 'chn_SDPUB0000008', now()),
  ('msg_SDM000000009', 'chn_SDDM00000009', now());
INSERT INTO public.chat_message_contents (message_id, body) VALUES
  ('msg_SDM000000001', 'one'), ('msg_SDM000000002', 'two'), ('msg_SDM000000003', 'three'), ('msg_SDM000000004', 'four'),
  ('msg_SDM000000005', 'five'), ('msg_SDM000000006', 'six'), ('msg_SDM000000007', 'seven'), ('msg_SDM000000008', 'eight'),
  ('msg_SDM000000009', 'nine');
-- A deleted message in the staff DM: its text is never readable here (a different rule that stays).
INSERT INTO public.chat_messages (id, channel_id, created_at, deleted_at) VALUES ('msg_SDM00000000D', 'chn_SDDM00000001', now(), now());
INSERT INTO public.chat_message_contents (message_id, body) VALUES ('msg_SDM00000000D', 'deleted');

-- The definition of a staff member --------------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('authenticated', 'public.staff_member_ids()', 'EXECUTE') AND has_function_privilege('service_role', 'public.staff_member_ids()', 'EXECUTE'), 'the staff list is for the server only');
SELECT ok(NOT has_function_privilege('authenticated', 'public.chat_dm_has_staff(text)', 'EXECUTE'), 'the internal check is not callable by signed-in users');
SELECT ok(NOT has_function_privilege('anon', 'public.chat_channel_includes_staff(text)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.chat_channel_includes_staff(text)', 'EXECUTE'), 'the notice check is for signed-in users only');
SELECT is(
  (SELECT string_agg(i, ',' ORDER BY i) FROM public.staff_member_ids() i WHERE i LIKE 'mbr_SD%'),
  'mbr_SDAAAAAAAAA1,mbr_SDAAAAAAAAC1,mbr_SDAAAAAAAAS1',
  'staff = the staff table link, the admin''s member and the community manager''s member; not members, not an assistant'
);

-- Fern, a participant ----------------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e5d1","role":"authenticated","email":"sd-fern@example.test"}', true);
SELECT is(
  (SELECT string_agg(body, ',' ORDER BY body) FROM public.chat_message_contents WHERE message_id LIKE 'msg_SDM%'),
  'eight,five,four,nine,one,seven,six,three,two',
  'a participant reads the conversations they are in (a deleted message never)'
);
SELECT ok(public.chat_channel_includes_staff('chn_SDDM00000001'), 'a Hub DM with a staff-table member includes staff');
SELECT ok(public.chat_channel_includes_staff('chn_SDDM00000003'), 'a Slack DM includes staff when Slack lists a staff member, though she has not pulled it');
SELECT ok(public.chat_channel_includes_staff('chn_SDGRP0000004'), 'a group DM with one staff member includes staff');
SELECT ok(NOT public.chat_channel_includes_staff('chn_SDDM00000002'), 'a Hub DM between two members does not');
SELECT ok(NOT public.chat_channel_includes_staff('chn_SDDM00000006'), 'nor a Slack DM between two members');
SELECT ok(NOT public.chat_channel_includes_staff('chn_SDGRP0000005'), 'nor a group DM without staff');
SELECT ok(NOT public.chat_channel_includes_staff('chn_SDGRP0000007'), 'nor one the staff member has left');
SELECT ok(NOT public.chat_channel_includes_staff('chn_SDDM00000009'), 'an assistant is not staff for this rule');
SELECT ok(NOT public.chat_channel_includes_staff('chn_SDPUB0000008'), 'a channel is never a staff DM');
SELECT ok(NOT public.chat_staff_can_read_dm('chn_SDDM00000001'), 'a member does not get team access by being in the conversation');
SELECT ok(NOT public.chat_log_staff_dm_read('chn_SDDM00000001'), 'nothing is logged for a member');

-- Orla, a member who is in none of them ------------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e5d6","role":"authenticated","email":"sd-orla@example.test"}', true);
SELECT is((SELECT count(*)::int FROM public.chat_message_contents WHERE message_id LIKE 'msg_SDM%'), 1, 'a member outside reads only the public channel');
SELECT is((SELECT count(*)::int FROM public.chat_channels WHERE id LIKE 'chn_SD%' AND kind <> 'channel'), 0, 'and sees none of the direct messages');
SELECT ok(NOT public.chat_channel_includes_staff('chn_SDDM00000001'), 'and cannot ask whether someone else''s conversation includes staff');
SELECT ok(NOT public.chat_log_staff_dm_read('chn_SDDM00000001'), 'nor leave a read on record');

-- Boris, an admin who is in none of them -------------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e5d4","role":"authenticated","email":"sd-boris@example.test"}', true);
SELECT is(
  (SELECT string_agg(body, ',' ORDER BY body) FROM public.chat_message_contents WHERE message_id LIKE 'msg_SDM%'),
  'eight,four,one,three',
  'an admin reads the DMs with staff in them (Hub, Slack-only and group), the public channel, and nothing else; never a deleted message'
);
SELECT is((SELECT count(*)::int FROM public.chat_channels WHERE id LIKE 'chn_SD%' AND kind <> 'channel'), 8, 'an admin still sees every conversation''s metadata, as before');
SELECT is((SELECT count(*)::int FROM public.chat_messages WHERE id LIKE 'msg_SDM%'), 10, 'and every message''s metadata');
SELECT ok(public.chat_staff_can_read_dm('chn_SDDM00000003'), 'the admin may read a staff DM');
SELECT ok(NOT public.chat_staff_can_read_dm('chn_SDDM00000002'), 'but not a DM between two members: that stays break-glass');
SELECT ok(public.chat_channel_includes_staff('chn_SDDM00000001'), 'the admin can ask about a staff DM');
SELECT ok(NOT public.chat_channel_includes_staff('chn_SDDM00000006'), 'and a plain one answers no');
SELECT ok(public.chat_log_staff_dm_read('chn_SDDM00000001'), 'opening a staff DM leaves a read on record');
SELECT ok(public.chat_log_staff_dm_read('chn_SDDM00000001'), 'and opening it again within the hour is still on record');
SELECT ok(NOT public.chat_log_staff_dm_read('chn_SDDM00000002'), 'a DM between two members is not logged: it is not readable this way');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'staff_dm_read' AND entity_id = 'chn_SDDM00000001' AND changed_by = '00000000-0000-4000-a000-00000000e5d4' AND actor_kind = 'staff' AND action = 'insert'),
  1,
  'one entry for the reader and the conversation, naming no text and no member'
);
SELECT is(
  (SELECT count(*)::int FROM public.get_activity_feed(p_audit_only := true, p_kinds := ARRAY['audit'], p_entity_types := ARRAY['staff_dm_read']) f
    WHERE f.entity_id = 'chn_SDDM00000001' AND f.actor_user_id = '00000000-0000-4000-a000-00000000e5d4'),
  1,
  'the Activity Log''s Privacy view lists it, with who looked'
);
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'staff_dm_read' AND member_id IS NOT NULL), 0, 'the entry is about the reader''s access, not about a member');

-- Cleo, a community manager (in the group DM 4 only) -----------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e5d5","role":"authenticated","email":"sd-cleo@example.test"}', true);
SELECT is(
  (SELECT string_agg(body, ',' ORDER BY body) FROM public.chat_message_contents WHERE message_id LIKE 'msg_SDM%'),
  'eight,four,one,three',
  'a community manager reads the same staff DMs (and the public channel), nothing else'
);
SELECT is(
  (SELECT string_agg(id, ',' ORDER BY id) FROM public.chat_channels WHERE id LIKE 'chn_SD%' AND kind <> 'channel'),
  'chn_SDDM00000001,chn_SDDM00000003,chn_SDGRP0000004',
  'and sees only those direct messages, not the metadata of the others (an admin''s wider reach is not hers)'
);
SELECT is((SELECT count(*)::int FROM public.chat_channel_members WHERE channel_id = 'chn_SDDM00000002'), 0, 'she does not see who is in a DM between two members');
SELECT ok(NOT public.chat_log_staff_dm_read('chn_SDGRP0000004'), 'a read of a conversation she is in is not logged');
SELECT ok(public.chat_log_staff_dm_read('chn_SDDM00000001'), 'a read of one she is not in is');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'staff_dm_read'), 0, 'and she cannot read the audit log');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'staff_dm_read' AND entity_id = 'chn_SDDM00000001'), 2, 'the log holds one entry for each of the two readers');

SELECT * FROM finish(true);
ROLLBACK;
