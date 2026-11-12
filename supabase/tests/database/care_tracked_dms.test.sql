-- pgTAP tests for 20270630000000_care_tracked_dms.sql: a staff user (admin or community manager) reads, tracks and untracks
-- only THEIR OWN Slack DMs, an admin does not read another staff user's list, a plain member and a signed-out visitor
-- do nothing, nothing is hard deleted by a user and only deleted_at can change; the table is declared the way the rules
-- ask and is not audited; and care_dm_last_messages answers (who wrote last, when; never text) to the service role only.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(39);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000dd01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dm-manager@example.test'),
  ('00000000-0000-4000-a000-00000000dd02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dm-plain@example.test'),
  ('00000000-0000-4000-a000-00000000dd03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dm-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000dd01', 'dm-manager@example.test', 'community_manager'),
  ('00000000-0000-4000-a000-00000000dd02', 'dm-plain@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000dd03', 'dm-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_DmTrackAAAA1', 'Ada Example', 'dm-ada@example.test', now(), 'active', NULL),
  ('mbr_DmTrackAAAA2', 'Bea Example', 'dm-bea@example.test', now(), 'active', NULL),
  ('mbr_DmTrackAAAA3', 'Plain Member', 'dm-plain@example.test', now(), 'active', '00000000-0000-4000-a000-00000000dd02');

-- The table is declared the way the rules ask.
SELECT ok(
  (SELECT obj_description('public.care_tracked_dms'::regclass, 'pg_class') LIKE '%[id prefix: caredm_]%'),
  'the table comment records its id prefix');
SELECT ok(
  (SELECT column_default LIKE '%new_id(''caredm''%' AND data_type = 'text'
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'care_tracked_dms' AND column_name = 'id'),
  'the id is text from new_id(caredm)');
SELECT ok(NOT has_table_privilege('anon', 'public.care_tracked_dms', 'SELECT'), 'a signed-out visitor has no grant');
SELECT ok(has_table_privilege('authenticated', 'public.care_tracked_dms', 'SELECT') AND has_table_privilege('authenticated', 'public.care_tracked_dms', 'INSERT'), 'a signed-in user can read and add, RLS decides which');
SELECT ok(NOT has_table_privilege('authenticated', 'public.care_tracked_dms', 'DELETE'), 'no user can hard delete');
SELECT ok(has_column_privilege('authenticated', 'public.care_tracked_dms', 'deleted_at', 'UPDATE'), 'a user can untrack (set deleted_at)');
SELECT ok(NOT has_column_privilege('authenticated', 'public.care_tracked_dms', 'member_id', 'UPDATE') AND NOT has_column_privilege('authenticated', 'public.care_tracked_dms', 'tracked_by', 'UPDATE') AND NOT has_column_privilege('authenticated', 'public.care_tracked_dms', 'slack_channel_id', 'UPDATE'), 'and nothing else about a row');
SELECT ok(has_table_privilege('service_role', 'public.care_tracked_dms', 'DELETE'), 'the service role can delete');
SELECT is((SELECT count(*)::int FROM public.member_data_handling WHERE table_name = 'care_tracked_dms' AND column_name = 'member_id' AND action = 'delete'), 1, 'the table has its removal-request decision');

-- The community manager tracks two DMs.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000dd01", "email": "dm-manager@example.test", "role": "authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.care_tracked_dms (id, tracked_by, slack_channel_id, member_id)
    VALUES ('caredm_DmTrackA001', '00000000-0000-4000-a000-00000000dd01', 'D0EXAMPLE001', 'mbr_DmTrackAAAA1')$$,
  'a community manager tracks a DM');
SELECT lives_ok(
  $$INSERT INTO public.care_tracked_dms (id, tracked_by, slack_channel_id, member_id)
    VALUES ('caredm_DmTrackA002', '00000000-0000-4000-a000-00000000dd01', 'D0EXAMPLE002', 'mbr_DmTrackAAAA2')$$,
  'and another');
SELECT is((SELECT count(*)::int FROM public.care_tracked_dms WHERE id LIKE 'caredm_DmTrackA%'), 2, 'and reads both');
SELECT throws_ok(
  $$INSERT INTO public.care_tracked_dms (tracked_by, slack_channel_id, member_id)
    VALUES ('00000000-0000-4000-a000-00000000dd03', 'D0EXAMPLE003', 'mbr_DmTrackAAAA1')$$,
  '42501', NULL, 'but cannot track a DM in someone else''s name');
SELECT throws_ok(
  $$INSERT INTO public.care_tracked_dms (tracked_by, slack_channel_id, member_id)
    VALUES ('00000000-0000-4000-a000-00000000dd01', 'D0EXAMPLE001', 'mbr_DmTrackAAAA1')$$,
  '23505', NULL, 'a DM is tracked once at a time');
SELECT throws_ok(
  $$INSERT INTO public.care_tracked_dms (tracked_by, slack_channel_id, member_id)
    VALUES ('00000000-0000-4000-a000-00000000dd01', '', 'mbr_DmTrackAAAA1')$$,
  '23514', NULL, 'a DM needs its Slack conversation id');
SELECT throws_ok(
  $$INSERT INTO public.care_tracked_dms (tracked_by, slack_channel_id, member_id)
    VALUES ('00000000-0000-4000-a000-00000000dd01', 'D0EXAMPLE009', 'mbr_NoSuchMember1')$$,
  '23503', NULL, 'and a member who exists');
SELECT throws_ok(
  $$UPDATE public.care_tracked_dms SET member_id = 'mbr_DmTrackAAAA2' WHERE id = 'caredm_DmTrackA001'$$,
  '42501', NULL, 'the member a row is about cannot be changed');
SELECT throws_ok(
  $$UPDATE public.care_tracked_dms SET tracked_by = '00000000-0000-4000-a000-00000000dd03' WHERE id = 'caredm_DmTrackA001'$$,
  '42501', NULL, 'nor the user, so a row cannot be handed to someone else');
SELECT lives_ok(
  $$UPDATE public.care_tracked_dms SET deleted_at = now() WHERE id = 'caredm_DmTrackA002'$$,
  'untracking is an update of deleted_at');
SELECT lives_ok(
  $$INSERT INTO public.care_tracked_dms (id, tracked_by, slack_channel_id, member_id)
    VALUES ('caredm_DmTrackA003', '00000000-0000-4000-a000-00000000dd01', 'D0EXAMPLE002', 'mbr_DmTrackAAAA2')$$,
  'and an untracked DM can be tracked again, as a new row');
SELECT throws_ok($$DELETE FROM public.care_tracked_dms WHERE id = 'caredm_DmTrackA001'$$, '42501', NULL, 'a user cannot delete a row');

-- An admin has a list of their own and cannot see hers.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000dd03", "email": "dm-admin@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.care_tracked_dms WHERE id LIKE 'caredm_DmTrackA%'), 0, 'an admin does not read another staff user''s tracked DMs');
SELECT lives_ok(
  $$INSERT INTO public.care_tracked_dms (id, tracked_by, slack_channel_id, member_id)
    VALUES ('caredm_DmTrackA004', '00000000-0000-4000-a000-00000000dd03', 'D0EXAMPLE001', 'mbr_DmTrackAAAA1')$$,
  'but tracks the same DM for themselves');
SELECT is((SELECT count(*)::int FROM public.care_tracked_dms WHERE id LIKE 'caredm_DmTrackA%'), 1, 'and reads only their own');
SELECT is_empty($$UPDATE public.care_tracked_dms SET deleted_at = now() WHERE id = 'caredm_DmTrackA001' RETURNING 1$$, 'an admin cannot untrack hers');
SELECT throws_ok(
  $$INSERT INTO public.care_tracked_dms (tracked_by, slack_channel_id, member_id)
    VALUES ('00000000-0000-4000-a000-00000000dd01', 'D0EXAMPLE005', 'mbr_DmTrackAAAA1')$$,
  '42501', NULL, 'or track one as her');

-- She reads only hers again, untracked ones included (soft deleted rows are kept).
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000dd01", "email": "dm-manager@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.care_tracked_dms WHERE id LIKE 'caredm_DmTrackA%'), 3, 'she reads her own rows, the untracked one kept');
SELECT is((SELECT count(*)::int FROM public.care_tracked_dms WHERE id LIKE 'caredm_DmTrackA%' AND deleted_at IS NULL), 2, 'two of them live');

-- A plain member sees and does nothing.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000dd02", "email": "dm-plain@example.test", "role": "authenticated"}', true);
SELECT is_empty($$SELECT 1 FROM public.care_tracked_dms$$, 'a plain member reads no tracked DMs');
SELECT throws_ok(
  $$INSERT INTO public.care_tracked_dms (tracked_by, slack_channel_id, member_id)
    VALUES ('00000000-0000-4000-a000-00000000dd02', 'D0EXAMPLE006', 'mbr_DmTrackAAAA1')$$,
  '42501', NULL, 'and cannot track a DM');
SELECT is_empty($$UPDATE public.care_tracked_dms SET deleted_at = now() RETURNING 1$$, 'or untrack one');

-- A signed-out visitor.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT 1 FROM public.care_tracked_dms$$, '42501', NULL, 'a signed-out visitor is refused');

-- Not audited: it is a private working list.
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_id LIKE 'caredm_%' OR entity_type LIKE 'care_tracked%'), 0, 'tracking and untracking write no audit rows');

------------------------------------------------------------------------------------------------
-- care_dm_last_messages: who wrote last in each conversation, and when. No text.
------------------------------------------------------------------------------------------------

INSERT INTO bronze.slack_messages (channel_id, message_ts, user_id, occurred_at, message_type, thread_ts, deleted_at, raw_payload) VALUES
  ('D0EXAMPLE001', '1000.000001', 'U0STAFF001', '2026-03-01T15:00:00Z', 'message', NULL, NULL, '{}'),
  ('D0EXAMPLE001', '1000.000002', 'U0ADA00001', '2026-03-01T16:00:00Z', NULL, NULL, NULL, '{}'),
  ('D0EXAMPLE001', '1000.000003', 'U0ADA00001', '2026-03-02T09:00:00Z', 'file_share', NULL, NULL, '{}'),
  -- A reply in a thread counts as the person writing.
  ('D0EXAMPLE001', '1000.000004', 'U0STAFF001', '2026-03-03T09:00:00Z', NULL, '1000.000002', NULL, '{}'),
  -- Deleted, and a Slack notice: neither is somebody writing.
  ('D0EXAMPLE001', '1000.000005', 'U0ADA00001', '2026-03-09T09:00:00Z', NULL, NULL, '2026-03-09T10:00:00Z', '{}'),
  ('D0EXAMPLE001', '1000.000006', 'U0STAFF001', '2026-03-10T09:00:00Z', 'channel_join', NULL, NULL, '{}'),
  ('D0EXAMPLE002', '2000.000001', 'U0BEA00001', '2026-03-05T12:00:00Z', NULL, NULL, NULL, '{}'),
  ('D0EXAMPLE003', '3000.000001', 'U0ELSE0001', '2026-03-06T12:00:00Z', NULL, NULL, NULL, '{}');

SET LOCAL ROLE service_role;
SELECT results_eq(
  $$SELECT channel_id, user_id, last_at FROM public.care_dm_last_messages(ARRAY['D0EXAMPLE001', 'D0EXAMPLE002'], ARRAY['channel_join', 'group_join']) ORDER BY channel_id, user_id$$,
  $$VALUES ('D0EXAMPLE001'::text, 'U0ADA00001'::text, '2026-03-02T09:00:00Z'::timestamptz),
           ('D0EXAMPLE001', 'U0STAFF001', '2026-03-03T09:00:00Z'),
           ('D0EXAMPLE002', 'U0BEA00001', '2026-03-05T12:00:00Z')$$,
  'the latest live message of each person in each asked-for conversation: threads and files count, deleted messages and Slack notices do not, other conversations are left out');
SELECT is_empty($$SELECT 1 FROM public.care_dm_last_messages(ARRAY[]::text[], ARRAY[]::text[])$$, 'asking for no conversations answers nothing');
SELECT ok((SELECT count(*) = 2 FROM public.care_dm_last_messages(ARRAY['D0EXAMPLE001'], ARRAY['channel_join'])), 'one conversation, two people');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000dd03", "email": "dm-admin@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.care_dm_last_messages(ARRAY['D0EXAMPLE001'], ARRAY['channel_join'])$$, '42501', NULL, 'an admin cannot ask who wrote last in someone''s DM');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.care_dm_last_messages(ARRAY['D0EXAMPLE001'], ARRAY['channel_join'])$$, '42501', NULL, 'nor a signed-out visitor');
RESET ROLE;
SELECT ok(NOT has_function_privilege('authenticated', 'public.care_dm_last_messages(text[], text[])', 'EXECUTE') AND has_function_privilege('service_role', 'public.care_dm_last_messages(text[], text[])', 'EXECUTE'), 'only the service role may call it');

SELECT * FROM finish(true);
ROLLBACK;
