-- pgTAP tests for 20270626000000_hedgie_care.sql: staff (admin and community manager) read and write care engagements, a
-- plain member and a signed-out visitor do not, nothing is hard deleted by a user, one open engagement per member and
-- channel, a period has an end date and a close has a way it ended, renewing is one step that a double click cannot
-- repeat, a community manager may read member_interactions (and nothing more of it), and the audit log records her writes
-- as staff without the message bookkeeping. The first build's `conversations` table is gone.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(54);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000cc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cv-manager@example.test'),
  ('00000000-0000-4000-a000-00000000cc02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cv-plain@example.test'),
  ('00000000-0000-4000-a000-00000000cc03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cv-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000cc01', 'cv-manager@example.test', 'community_manager'),
  ('00000000-0000-4000-a000-00000000cc02', 'cv-plain@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000cc03', 'cv-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_CareAAAAAAA1', 'Ada Example', 'cv-ada@example.test', now(), 'active', NULL),
  ('mbr_CareAAAAAAA2', 'Bea Example', 'cv-bea@example.test', now(), 'active', NULL),
  ('mbr_CareAAAAAAA3', 'Plain Member', 'cv-plain@example.test', now(), 'active', '00000000-0000-4000-a000-00000000cc02');

-- Two interactions to read (service role writes, as the rebuild does).
INSERT INTO public.member_interactions (member_a, member_b, kind, occurred_at, visibility) VALUES
  ('mbr_CareAAAAAAA1', 'mbr_CareAAAAAAA2', 'dm', now(), 'private'),
  ('mbr_CareAAAAAAA2', 'mbr_CareAAAAAAA1', 'reaction', now(), 'public');

-- The first build's table is gone, and the removal-request catalog follows.
SELECT hasnt_table('public', 'conversations', 'the first build''s conversations table is dropped');
SELECT is((SELECT count(*)::int FROM public.member_data_handling WHERE table_name = 'conversations'), 0, 'its removal-request decision is gone');
SELECT is((SELECT count(*)::int FROM public.member_data_handling WHERE table_name = 'care_engagements' AND column_name = 'member_id' AND action = 'delete'), 1, 'the new table has its removal-request decision');

-- The table is declared the way the rules ask.
SELECT ok(
  (SELECT obj_description('public.care_engagements'::regclass, 'pg_class') LIKE '%[id prefix: care_]%'),
  'the table comment records its id prefix');
SELECT ok(
  (SELECT column_default LIKE '%new_id(''care''%' AND data_type = 'text'
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'care_engagements' AND column_name = 'id'),
  'the id is text from new_id(care)');
SELECT ok(NOT has_table_privilege('anon', 'public.care_engagements', 'SELECT'), 'a signed-out visitor has no grant');
SELECT ok(has_table_privilege('authenticated', 'public.care_engagements', 'INSERT'), 'a signed-in user can insert, RLS decides which');
SELECT ok(NOT has_table_privilege('authenticated', 'public.care_engagements', 'DELETE'), 'no user can hard delete');
SELECT ok(has_table_privilege('service_role', 'public.care_engagements', 'DELETE'), 'the service role can');
SELECT ok(NOT has_function_privilege('anon', 'public.renew_care_engagement(text, date, uuid, timestamptz)', 'EXECUTE'), 'a signed-out visitor cannot renew');
SELECT ok(has_function_privilege('authenticated', 'public.renew_care_engagement(text, date, uuid, timestamptz)', 'EXECUTE'), 'a signed-in user can call renew, RLS decides what it does');

-- The community manager starts one.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cc01", "email": "cv-manager@example.test", "role": "authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.care_engagements (id, member_id, opened_by, reason, channel, period_ends_on, notes)
    VALUES ('care_CareAAAAAA01', 'mbr_CareAAAAAAA1', '00000000-0000-4000-a000-00000000cc01', 'writing_check_in', 'slack_dm', current_date + 30, 'said hello')$$,
  'a community manager starts an engagement');
SELECT is((SELECT count(*)::int FROM public.care_engagements WHERE id = 'care_CareAAAAAA01'), 1, 'and reads it');
SELECT throws_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, channel, period_ends_on)
    VALUES ('mbr_CareAAAAAAA2', '00000000-0000-4000-a000-00000000cc03', 'welcome', 'slack_dm', current_date + 30)$$,
  '42501', NULL, 'but cannot start one in someone else''s name');
SELECT throws_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, channel, period_ends_on)
    VALUES ('mbr_CareAAAAAAA1', '00000000-0000-4000-a000-00000000cc01', 'welcome', 'slack_dm', current_date + 30)$$,
  '23505', NULL, 'a second open engagement with the same member on the same channel is refused');
SELECT lives_ok(
  $$INSERT INTO public.care_engagements (id, member_id, opened_by, reason, channel, period_ends_on)
    VALUES ('care_CareAAAAAA02', 'mbr_CareAAAAAAA1', '00000000-0000-4000-a000-00000000cc01', 'introduction', 'email', current_date + 30)$$,
  'another channel is a separate engagement');
SELECT throws_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, channel, period_ends_on)
    VALUES ('mbr_CareAAAAAAA2', '00000000-0000-4000-a000-00000000cc01', 'gossip', 'slack_dm', current_date + 30)$$,
  '23514', NULL, 'a reason outside the set is refused');
SELECT throws_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, channel, period_ends_on)
    VALUES ('mbr_CareAAAAAAA2', '00000000-0000-4000-a000-00000000cc01', 'welcome', 'carrier_pigeon', current_date + 30)$$,
  '23514', NULL, 'a channel outside the set is refused');
SELECT throws_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, channel)
    VALUES ('mbr_CareAAAAAAA2', '00000000-0000-4000-a000-00000000cc01', 'welcome', 'slack_dm')$$,
  '23502', NULL, 'a period needs its last day');
SELECT throws_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, channel, period_ends_on, notes)
    VALUES ('mbr_CareAAAAAAA2', '00000000-0000-4000-a000-00000000cc01', 'welcome', 'slack_dm', current_date + 30, repeat('x', 1001))$$,
  '23514', NULL, 'a note over the limit is refused');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET closed_at = now() WHERE id = 'care_CareAAAAAA01'$$,
  '23514', NULL, 'closing needs how it ended');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET ended_how = 'no_reply' WHERE id = 'care_CareAAAAAA01'$$,
  '23514', NULL, 'and how it ended needs closing');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET closed_at = now(), ended_how = 'vanished' WHERE id = 'care_CareAAAAAA01'$$,
  '23514', NULL, 'an ending outside the set is refused');

-- Logging a message, then renewing.
SELECT lives_ok(
  $$UPDATE public.care_engagements SET last_member_message_at = now() WHERE id = 'care_CareAAAAAA01'$$,
  'logging that the member replied');
SELECT is(
  (SELECT count(*)::int FROM public.renew_care_engagement('care_CareAAAAAA01', current_date + 60, '00000000-0000-4000-a000-00000000cc01', now())),
  1, 'renewing an open engagement answers the new period');
SELECT is(
  (SELECT ended_how FROM public.care_engagements WHERE id = 'care_CareAAAAAA01'),
  'renewed', 'the old period is closed as renewed');
SELECT ok(
  (SELECT closed_at IS NOT NULL FROM public.care_engagements WHERE id = 'care_CareAAAAAA01'),
  'with its closing time');
SELECT is(
  (SELECT count(*)::int FROM public.care_engagements WHERE renewed_from = 'care_CareAAAAAA01' AND closed_at IS NULL AND member_id = 'mbr_CareAAAAAAA1' AND channel = 'slack_dm' AND reason = 'writing_check_in' AND notes IS NULL AND last_member_message_at IS NOT NULL),
  1, 'the next period continues it: same member, channel and reason, who spoke last kept, notes fresh');
SELECT is(
  (SELECT count(*)::int FROM public.renew_care_engagement('care_CareAAAAAA01', current_date + 60, '00000000-0000-4000-a000-00000000cc01', now())),
  0, 'a double click renews nothing the second time');
SELECT is(
  (SELECT count(*)::int FROM public.care_engagements WHERE member_id = 'mbr_CareAAAAAAA1' AND channel = 'slack_dm' AND closed_at IS NULL AND deleted_at IS NULL),
  1, 'so there is still exactly one open period for the member and channel');
SELECT throws_ok(
  $$SELECT * FROM public.renew_care_engagement('care_CareAAAAAA02', current_date + 60, '00000000-0000-4000-a000-00000000cc03', now())$$,
  '42501', NULL, 'renewing cannot start a period in someone else''s name');
SELECT is(
  (SELECT count(*)::int FROM public.renew_care_engagement('care_NoSuchRow0001', current_date + 60, '00000000-0000-4000-a000-00000000cc01', now())),
  0, 'renewing one that does not exist renews nothing');

SELECT lives_ok(
  $$UPDATE public.care_engagements SET closed_at = now(), ended_how = 'back_in_community', notes = 'came back' WHERE id = 'care_CareAAAAAA02'$$,
  'closing with how it ended');
SELECT lives_ok(
  $$UPDATE public.care_engagements SET deleted_at = now() WHERE renewed_from = 'care_CareAAAAAA01'$$,
  'a soft delete is an update');
SELECT throws_ok($$DELETE FROM public.care_engagements WHERE id = 'care_CareAAAAAA01'$$, '42501', NULL, 'a user cannot delete a row');

-- The member's timeline: only this source, as staff, as herself.
SELECT lives_ok(
  $$INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, actor_user_id, engagement_value, occurred_at, source, related_id)
    VALUES ('mbr_CareAAAAAAA1', 'care_started', 'communication', 'Hedgie Care started', 'staff', '00000000-0000-4000-a000-00000000cc01', 0, now(), 'care', 'care_CareAAAAAA01')$$,
  'she writes the timeline row for an engagement');
SELECT throws_ok(
  $$INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, actor_user_id, engagement_value, occurred_at, source, related_id)
    VALUES ('mbr_CareAAAAAAA1', 'conversation_opened', 'communication', 'Old', 'staff', '00000000-0000-4000-a000-00000000cc01', 0, now(), 'conversations', 'x')$$,
  '42501', NULL, 'the first build''s source is no longer allowed');
SELECT throws_ok(
  $$INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, actor_user_id, engagement_value, occurred_at, source)
    VALUES ('mbr_CareAAAAAAA1', 'slack_message', 'communication', 'Forged', 'staff', '00000000-0000-4000-a000-00000000cc01', 5, now(), 'slack')$$,
  '42501', NULL, 'and no other timeline row');
SELECT throws_ok(
  $$INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, actor_user_id, engagement_value, occurred_at, source)
    VALUES ('mbr_CareAAAAAAA1', 'care_started', 'communication', 'As someone else', 'staff', '00000000-0000-4000-a000-00000000cc03', 0, now(), 'care')$$,
  '42501', NULL, 'nor one written as someone else');

-- Who a member talked with: she may read it, never change it.
SELECT is((SELECT count(*)::int FROM public.member_interactions), 2, 'a community manager reads member_interactions');
SELECT throws_ok(
  $$INSERT INTO public.member_interactions (member_a, member_b, kind, occurred_at, visibility)
    VALUES ('mbr_CareAAAAAAA1', 'mbr_CareAAAAAAA2', 'dm', now(), 'private')$$,
  '42501', NULL, 'but not write it');

-- A plain member sees and does nothing.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cc02", "email": "cv-plain@example.test", "role": "authenticated"}', true);
SELECT is_empty($$SELECT 1 FROM public.care_engagements$$, 'a plain member reads no engagements');
SELECT is_empty($$SELECT 1 FROM public.member_interactions$$, 'nor member_interactions');
SELECT throws_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, channel, period_ends_on)
    VALUES ('mbr_CareAAAAAAA2', '00000000-0000-4000-a000-00000000cc02', 'welcome', 'slack_dm', current_date + 30)$$,
  '42501', NULL, 'and cannot start one');
SELECT is_empty($$UPDATE public.care_engagements SET notes = 'x' RETURNING 1$$, 'or change one');
SELECT is((SELECT count(*)::int FROM public.renew_care_engagement('care_CareAAAAAA02', current_date + 60, '00000000-0000-4000-a000-00000000cc02', now())), 0, 'or renew one');

-- A signed-out visitor.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT 1 FROM public.care_engagements$$, '42501', NULL, 'a signed-out visitor is refused');

-- An admin works with the same rows.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cc03", "email": "cv-admin@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.care_engagements WHERE id LIKE 'care_CareAAAAAA%'), 2, 'an admin reads them all');
SELECT lives_ok(
  $$INSERT INTO public.care_engagements (id, member_id, opened_by, reason, channel, period_ends_on)
    VALUES ('care_CareAAAAAA05', 'mbr_CareAAAAAAA2', '00000000-0000-4000-a000-00000000cc03', 'welcome', 'prickle', current_date + 30)$$,
  'and starts one');
RESET ROLE;

-- The audit log: her writes are staff actions, once per intent, without the message bookkeeping.
SELECT is(
  (SELECT actor_kind || ':' || member_id FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareAAAAAA01' ORDER BY id LIMIT 1),
  'staff:mbr_CareAAAAAAA1',
  'a community manager''s engagement is audited as staff, about the member');
-- (Inside this one transaction the trigger folds a row's later changes into its insert row, as it does for a pipeline's
-- repeated writes, so the start, the reply and the renewal of the first engagement read as one entry.)
SELECT ok(
  (SELECT count(*) = 1 AND bool_and((changes -> 'last_member_message_at' ->> 'new') IS NULL AND NOT changes ? 'updated_at')
     FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareAAAAAA01'),
  'logging a reply wrote no audit row, and no row carries updated_at or the reply bookkeeping');
SELECT is(
  (SELECT changes -> 'ended_how' ->> 'new' FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareAAAAAA01'),
  'renewed', 'the renewal shows on the old period as closed as renewed');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'care_engagement' AND action = 'insert' AND changes -> 'renewed_from' ->> 'new' = 'care_CareAAAAAA01' AND actor_kind = 'staff'),
  1, 'and as one insert for the new period, linked to it, as staff');
SELECT is(
  (SELECT actor_kind FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareAAAAAA05'),
  'staff', 'an admin''s is staff too');

SELECT * FROM finish(true);
ROLLBACK;
