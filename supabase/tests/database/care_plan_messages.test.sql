-- pgTAP test for 20270708000000_care_plan_messages.sql: the one definition of a staff member, which chat DMs are tracked in a
-- Hedgie Care plan (the notice in Hub Chat), the audit entry for opening a member's plan messages, and that no chat read policy
-- was widened for staff. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(33);

-- People: Fern, Gale and Orla are plain members (Orla is in none of the conversations); Stella is linked in the staff roster
-- (no account); Ada is an admin with a member record; Cleo is a community manager with a member record; Ines has an assistant account.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e5d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp-fern@example.test'),
  ('00000000-0000-4000-a000-00000000e5d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp-gale@example.test'),
  ('00000000-0000-4000-a000-00000000e5d3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp-ada@example.test'),
  ('00000000-0000-4000-a000-00000000e5d5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp-cleo@example.test'),
  ('00000000-0000-4000-a000-00000000e5d6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp-orla@example.test'),
  ('00000000-0000-4000-a000-00000000e5d7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp-ines@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e5d1', 'cp-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e5d2', 'cp-gale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e5d3', 'cp-ada@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000e5d5', 'cp-cleo@example.test', 'community_manager'),
  ('00000000-0000-4000-a000-00000000e5d6', 'cp-orla@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e5d7', 'cp-ines@example.test', 'assistant')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_CPAAAAAAAAF1', 'Cp Fern', 'cp-fern@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d1'),
  ('mbr_CPAAAAAAAAG1', 'Cp Gale', 'cp-gale@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d2'),
  ('mbr_CPAAAAAAAAS1', 'Cp Stella', 'cp-stella@example.test', now(), 'active', NULL),
  ('mbr_CPAAAAAAAAA1', 'Cp Ada', 'cp-ada@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d3'),
  ('mbr_CPAAAAAAAAC1', 'Cp Cleo', 'cp-cleo@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d5'),
  ('mbr_CPAAAAAAAAO1', 'Cp Orla', 'cp-orla@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d6'),
  ('mbr_CPAAAAAAAAI1', 'Cp Ines', 'cp-ines@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e5d7');
INSERT INTO public.staff (name, email, role, member_id) VALUES ('Cp Stella', 'cp-stella@example.test', 'staff', 'mbr_CPAAAAAAAAS1');

-- Slack DMs and a group DM in the chat. D1: Fern and Cleo (tracked by Cleo, who owns a plan of Fern). D2: Gale and Cleo, tracked by Cleo
-- but the only plan of Gale is owned by Ada. D3: Fern, tracked then untracked. D4: Gale, tracked by Ada, who opened Gale's plan
-- and so owns it (owned_by is empty). D5: a group DM tracked by Cleo for Fern. D6: Fern and Gale, nobody tracks it.
INSERT INTO public.chat_channels (id, kind, visibility, restricted, bridge_mode, slack_channel_id) VALUES
  ('chn_CPDM00000001', 'dm', 'private', true, 'bridged', 'CP_D1'),
  ('chn_CPDM00000002', 'dm', 'private', true, 'bridged', 'CP_D2'),
  ('chn_CPDM00000003', 'dm', 'private', true, 'bridged', 'CP_D3'),
  ('chn_CPDM00000004', 'dm', 'private', true, 'bridged', 'CP_D4'),
  ('chn_CPGRP0000005', 'group_dm', 'private', true, 'bridged', 'CP_D5'),
  ('chn_CPDM00000006', 'dm', 'private', true, 'bridged', 'CP_D6');
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES
  ('chn_CPDM00000001', 'mbr_CPAAAAAAAAF1'), ('chn_CPDM00000001', 'mbr_CPAAAAAAAAC1'),
  ('chn_CPDM00000002', 'mbr_CPAAAAAAAAG1'), ('chn_CPDM00000002', 'mbr_CPAAAAAAAAC1'),
  ('chn_CPDM00000003', 'mbr_CPAAAAAAAAF1'),
  ('chn_CPDM00000004', 'mbr_CPAAAAAAAAG1'),
  ('chn_CPGRP0000005', 'mbr_CPAAAAAAAAF1'),
  ('chn_CPDM00000006', 'mbr_CPAAAAAAAAF1'), ('chn_CPDM00000006', 'mbr_CPAAAAAAAAG1');
INSERT INTO public.chat_messages (id, channel_id, created_at) VALUES
  ('msg_CPM000000001', 'chn_CPDM00000001', now()), ('msg_CPM000000002', 'chn_CPDM00000002', now()), ('msg_CPM000000006', 'chn_CPDM00000006', now());
INSERT INTO public.chat_message_contents (message_id, body) VALUES
  ('msg_CPM000000001', 'one'), ('msg_CPM000000002', 'two'), ('msg_CPM000000006', 'six');

INSERT INTO public.care_tracked_dms (tracked_by, slack_channel_id, member_id, deleted_at) VALUES
  ('00000000-0000-4000-a000-00000000e5d5', 'CP_D1', 'mbr_CPAAAAAAAAF1', NULL),
  ('00000000-0000-4000-a000-00000000e5d5', 'CP_D2', 'mbr_CPAAAAAAAAG1', NULL),
  ('00000000-0000-4000-a000-00000000e5d5', 'CP_D3', 'mbr_CPAAAAAAAAF1', now()),
  ('00000000-0000-4000-a000-00000000e5d3', 'CP_D4', 'mbr_CPAAAAAAAAG1', NULL),
  ('00000000-0000-4000-a000-00000000e5d5', 'CP_D5', 'mbr_CPAAAAAAAAF1', NULL);
-- Fern's plan is owned by Cleo; Gale's by Ada (who opened it, so owned_by is empty: the owner is who opened it).
INSERT INTO public.care_engagements (member_id, reason, channel, opened_by, owned_by, period_ends_on) VALUES
  ('mbr_CPAAAAAAAAF1', 'introduction', 'slack_dm', '00000000-0000-4000-a000-00000000e5d5', '00000000-0000-4000-a000-00000000e5d5', '2026-12-01'),
  ('mbr_CPAAAAAAAAG1', 'introduction', 'slack_dm', '00000000-0000-4000-a000-00000000e5d3', NULL, '2026-12-01');

-- Grants ---------------------------------------------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('authenticated', 'public.staff_member_ids()', 'EXECUTE') AND has_function_privilege('service_role', 'public.staff_member_ids()', 'EXECUTE'), 'the staff list is for the server only');
SELECT ok(NOT has_function_privilege('anon', 'public.chat_dm_in_care_plan(text)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.chat_dm_in_care_plan(text)', 'EXECUTE'), 'the notice check is for signed-in users only');
SELECT ok(NOT has_function_privilege('anon', 'public.care_log_messages_read(text)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.care_log_messages_read(text)', 'EXECUTE'), 'the read log is for signed-in users only');
SELECT is(
  (SELECT string_agg(i, ',' ORDER BY i) FROM public.staff_member_ids() i WHERE i LIKE 'mbr_CP%'),
  'mbr_CPAAAAAAAAA1,mbr_CPAAAAAAAAC1,mbr_CPAAAAAAAAI1,mbr_CPAAAAAAAAS1',
  'staff = the roster link, the admin''s, community manager''s and assistant''s members; not plain members'
);

-- Fern, in a DM tracked in her care plan ---------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e5d1","role":"authenticated","email":"cp-fern@example.test"}', true);
SELECT ok(public.chat_dm_in_care_plan('chn_CPDM00000001'), 'her DM tracked by the owner of her plan is in a care plan');
SELECT ok(NOT public.chat_dm_in_care_plan('chn_CPDM00000003'), 'a DM that is no longer tracked is not');
SELECT ok(NOT public.chat_dm_in_care_plan('chn_CPGRP0000005'), 'a group message is never one');
SELECT ok(NOT public.chat_dm_in_care_plan('chn_CPDM00000006'), 'a DM nobody tracks is not');
SELECT ok(NOT public.chat_dm_in_care_plan('chn_CPDM00000002'), 'and she cannot ask about a conversation she cannot see');
SELECT ok(NOT public.care_log_messages_read('mbr_CPAAAAAAAAF1'), 'a member leaves no read on record, not even of herself');

-- Gale: D2 is tracked by Cleo, who owns none of Gale's plans; D4 is tracked by Ada, who owns Gale's plan --------------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e5d2","role":"authenticated","email":"cp-gale@example.test"}', true);
SELECT ok(NOT public.chat_dm_in_care_plan('chn_CPDM00000002'), 'tracked by someone who owns none of the member''s plans: not in a plan');
SELECT ok(public.chat_dm_in_care_plan('chn_CPDM00000004'), 'tracked by the person who opened the member''s plan (no separate owner): in a plan');

-- Orla, in none of them ------------------------------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e5d6","role":"authenticated","email":"cp-orla@example.test"}', true);
SELECT ok(NOT public.chat_dm_in_care_plan('chn_CPDM00000001'), 'someone outside the conversation cannot ask whether it is tracked');
SELECT ok(NOT public.care_log_messages_read('mbr_CPAAAAAAAAF1'), 'and leaves no read on record');
SELECT is((SELECT count(*)::int FROM public.chat_message_contents WHERE message_id LIKE 'msg_CPM%'), 0, 'and reads none of the text');

-- No chat policy was widened: an admin still has only metadata of DMs she is not in -------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e5d3","role":"authenticated","email":"cp-ada@example.test"}', true);
SELECT is((SELECT count(*)::int FROM public.chat_message_contents WHERE message_id LIKE 'msg_CPM%'), 0, 'an admin reads no DM text through chat, tracked in a plan or not (break-glass is unchanged)');
SELECT is((SELECT count(*)::int FROM public.chat_messages WHERE id LIKE 'msg_CPM%'), 3, 'and sees the metadata of every message, as before');
SELECT ok(public.chat_dm_in_care_plan('chn_CPDM00000001'), 'the admin can see that a DM is tracked in a plan');
SELECT ok(public.care_log_messages_read('mbr_CPAAAAAAAAF1'), 'opening a member''s plan messages is put on record');
SELECT ok(public.care_log_messages_read('mbr_CPAAAAAAAAF1'), 'and opening them again within the hour is still on record');
SELECT ok(NOT public.care_log_messages_read('mbr_CPZZZZZZZZZZ'), 'a member that does not exist is not');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'care_dm_read' AND entity_id = 'mbr_CPAAAAAAAAF1' AND changed_by = '00000000-0000-4000-a000-00000000e5d3' AND actor_kind = 'staff' AND action = 'insert' AND member_id = 'mbr_CPAAAAAAAAF1'),
  1,
  'one entry for the reader and the member, naming no text'
);
SELECT is(
  (SELECT count(*)::int FROM public.get_activity_feed(p_audit_only := true, p_kinds := ARRAY['audit'], p_entity_types := ARRAY['care_dm_read']) f
    WHERE f.entity_id = 'mbr_CPAAAAAAAAF1' AND f.actor_user_id = '00000000-0000-4000-a000-00000000e5d3' AND f.member_id = 'mbr_CPAAAAAAAAF1'),
  1,
  'the Activity Log''s Privacy view lists it, with who looked and whose messages'
);

-- Cleo, the community manager who tracks the DM: she reads no chat she is not in and cannot see the audit log -----------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e5d5","role":"authenticated","email":"cp-cleo@example.test"}', true);
SELECT is((SELECT count(*)::int FROM public.chat_channels WHERE id LIKE 'chn_CP%' AND kind <> 'channel'), 2, 'a community manager sees only the DMs she is in (no new chat reach)');
SELECT is((SELECT count(*)::int FROM public.chat_message_contents WHERE message_id LIKE 'msg_CPM%'), 2, 'and reads only their text');
SELECT ok(public.care_log_messages_read('mbr_CPAAAAAAAAG1'), 'her opening a member''s plan messages is on record too');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'care_dm_read'), 0, 'and she cannot read the audit log');

-- Ines, an assistant: not a reader ------------------------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e5d7","role":"authenticated","email":"cp-ines@example.test"}', true);
SELECT ok(NOT public.care_log_messages_read('mbr_CPAAAAAAAAF1'), 'an assistant leaves nothing on record: she may not open plan messages');
SELECT is((SELECT count(*)::int FROM public.chat_message_contents WHERE message_id LIKE 'msg_CPM%'), 0, 'and reads no DM text');

-- The server ----------------------------------------------------------------------------------------------------------------
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'care_dm_read' AND entity_id IN ('mbr_CPAAAAAAAAF1', 'mbr_CPAAAAAAAAG1')), 2, 'the log holds one entry per reader and member');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT ok(public.chat_dm_in_care_plan('chn_CPDM00000001'), 'the server sees every conversation');
SELECT ok(NOT public.chat_dm_in_care_plan('chn_CPDM00000002'), 'and the same rule applies to it');
SELECT ok(NOT public.care_log_messages_read('mbr_CPAAAAAAAAF1'), 'the server is no reader: it leaves no entry');
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
