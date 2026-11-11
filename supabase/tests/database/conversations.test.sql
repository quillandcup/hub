-- pgTAP tests for 20270624000000_conversations.sql: staff (admin and community manager) read and write
-- conversations, a plain member and a signed-out visitor do not, nothing is hard deleted by a user, one open
-- conversation per member and channel, and the audit log records a community manager's writes as staff.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(31);

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
  ('mbr_CnvAAAAAAAA1', 'Ada Example', 'cv-ada@example.test', now(), 'active', NULL),
  ('mbr_CnvAAAAAAAA2', 'Bea Example', 'cv-bea@example.test', now(), 'active', NULL),
  ('mbr_CnvAAAAAAAA3', 'Plain Member', 'cv-plain@example.test', now(), 'active', '00000000-0000-4000-a000-00000000cc02');

-- The table is declared the way the rules ask.
SELECT ok(
  (SELECT obj_description('public.conversations'::regclass, 'pg_class') LIKE '%[id prefix: conv_]%'),
  'the table comment records its id prefix');
SELECT ok(
  (SELECT column_default LIKE '%new_id(''conv''%' AND data_type = 'text'
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'id'),
  'the id is text from new_id(conv)');
SELECT ok(NOT has_table_privilege('anon', 'public.conversations', 'SELECT'), 'a signed-out visitor has no grant');
SELECT ok(has_table_privilege('authenticated', 'public.conversations', 'INSERT'), 'a signed-in user can insert, RLS decides which');
SELECT ok(NOT has_table_privilege('authenticated', 'public.conversations', 'DELETE'), 'no user can hard delete');
SELECT ok(has_table_privilege('service_role', 'public.conversations', 'DELETE'), 'the service role can');

-- The community manager opens one.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cc01", "email": "cv-manager@example.test", "role": "authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.conversations (id, member_id, opened_by, reason, channel, notes)
    VALUES ('conv_CnvAAAAAAA01', 'mbr_CnvAAAAAAAA1', '00000000-0000-4000-a000-00000000cc01', 'writing_check_in', 'slack_dm', 'said hello')$$,
  'a community manager opens a conversation');
SELECT is((SELECT count(*)::int FROM public.conversations WHERE id = 'conv_CnvAAAAAAA01'), 1, 'and reads it');
SELECT throws_ok(
  $$INSERT INTO public.conversations (member_id, opened_by, reason, channel)
    VALUES ('mbr_CnvAAAAAAAA2', '00000000-0000-4000-a000-00000000cc03', 'hello', 'slack_dm')$$,
  '42501', NULL, 'but cannot open one in someone else''s name');
SELECT throws_ok(
  $$INSERT INTO public.conversations (member_id, opened_by, reason, channel)
    VALUES ('mbr_CnvAAAAAAAA1', '00000000-0000-4000-a000-00000000cc01', 'hello', 'slack_dm')$$,
  '23505', NULL, 'a second open conversation with the same member on the same channel is refused');
SELECT lives_ok(
  $$INSERT INTO public.conversations (id, member_id, opened_by, reason, channel)
    VALUES ('conv_CnvAAAAAAA02', 'mbr_CnvAAAAAAAA1', '00000000-0000-4000-a000-00000000cc01', 'hello', 'email')$$,
  'another channel is a separate conversation');
SELECT throws_ok(
  $$INSERT INTO public.conversations (member_id, opened_by, reason, channel)
    VALUES ('mbr_CnvAAAAAAAA2', '00000000-0000-4000-a000-00000000cc01', 'gossip', 'slack_dm')$$,
  '23514', NULL, 'a reason outside the set is refused');
SELECT throws_ok(
  $$UPDATE public.conversations SET closed_at = now() WHERE id = 'conv_CnvAAAAAAA01'$$,
  '23514', NULL, 'closing needs an outcome');
SELECT throws_ok(
  $$UPDATE public.conversations SET outcome = 'resolved' WHERE id = 'conv_CnvAAAAAAA01'$$,
  '23514', NULL, 'and an outcome needs closing');

-- Logging a message, then closing.
SELECT lives_ok(
  $$UPDATE public.conversations SET last_member_message_at = now() WHERE id = 'conv_CnvAAAAAAA01'$$,
  'logging that the member replied');
SELECT lives_ok(
  $$UPDATE public.conversations SET closed_at = now(), outcome = 're_engaged', notes = 'came back' WHERE id = 'conv_CnvAAAAAAA01'$$,
  'closing with an outcome');
SELECT lives_ok(
  $$INSERT INTO public.conversations (id, member_id, opened_by, reason, channel)
    VALUES ('conv_CnvAAAAAAA03', 'mbr_CnvAAAAAAAA1', '00000000-0000-4000-a000-00000000cc01', 'check_in', 'slack_dm')$$,
  'closing it frees the member and channel for a new conversation');
SELECT lives_ok(
  $$UPDATE public.conversations SET deleted_at = now() WHERE id = 'conv_CnvAAAAAAA03'$$,
  'a soft delete is an update');
SELECT lives_ok(
  $$INSERT INTO public.conversations (id, member_id, opened_by, reason, channel)
    VALUES ('conv_CnvAAAAAAA04', 'mbr_CnvAAAAAAAA1', '00000000-0000-4000-a000-00000000cc01', 'check_in', 'slack_dm')$$,
  'and so frees it too');
SELECT throws_ok($$DELETE FROM public.conversations WHERE id = 'conv_CnvAAAAAAA04'$$, '42501', NULL, 'a user cannot delete a row');

-- The member's timeline: only this source, as staff, as herself.
SELECT lives_ok(
  $$INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, actor_user_id, engagement_value, occurred_at, source, related_id)
    VALUES ('mbr_CnvAAAAAAAA1', 'conversation_opened', 'communication', 'Conversation opened', 'staff', '00000000-0000-4000-a000-00000000cc01', 0, now(), 'conversations', 'conv_CnvAAAAAAA01')$$,
  'she writes the timeline row for a conversation');
SELECT throws_ok(
  $$INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, actor_user_id, engagement_value, occurred_at, source)
    VALUES ('mbr_CnvAAAAAAAA1', 'slack_message', 'communication', 'Forged', 'staff', '00000000-0000-4000-a000-00000000cc01', 5, now(), 'slack')$$,
  '42501', NULL, 'but no other timeline row');

-- A plain member sees and does nothing.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cc02", "email": "cv-plain@example.test", "role": "authenticated"}', true);
SELECT is_empty($$SELECT 1 FROM public.conversations$$, 'a plain member reads no conversations');
SELECT throws_ok(
  $$INSERT INTO public.conversations (member_id, opened_by, reason, channel)
    VALUES ('mbr_CnvAAAAAAAA2', '00000000-0000-4000-a000-00000000cc02', 'hello', 'slack_dm')$$,
  '42501', NULL, 'and cannot open one');
SELECT is_empty($$UPDATE public.conversations SET notes = 'x' RETURNING 1$$, 'or change one');

-- A signed-out visitor.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT 1 FROM public.conversations$$, '42501', NULL, 'a signed-out visitor is refused');

-- An admin works with the same rows.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cc03", "email": "cv-admin@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.conversations WHERE id LIKE 'conv_CnvAAAAAAA%'), 4, 'an admin reads them all');
SELECT lives_ok(
  $$INSERT INTO public.conversations (id, member_id, opened_by, reason, channel)
    VALUES ('conv_CnvAAAAAAA05', 'mbr_CnvAAAAAAAA2', '00000000-0000-4000-a000-00000000cc03', 'welcome', 'prickle')$$,
  'and opens one');
RESET ROLE;

-- The audit log: her writes are staff actions, once per intent, without the message bookkeeping.
SELECT is(
  (SELECT actor_kind || ':' || member_id FROM public.audit_log WHERE entity_type = 'conversation' AND entity_id = 'conv_CnvAAAAAAA01'),
  'staff:mbr_CnvAAAAAAAA1',
  'a community manager''s conversation is audited as staff, about the member (one row: her open, reply and close fold into it)');
SELECT ok(
  (SELECT changes ? 'outcome' AND (changes -> 'last_member_message_at' ->> 'new') IS NULL AND NOT changes ? 'updated_at'
     FROM public.audit_log WHERE entity_type = 'conversation' AND entity_id = 'conv_CnvAAAAAAA01'),
  'it carries the outcome, not the reply bookkeeping or updated_at');
SELECT is(
  (SELECT actor_kind FROM public.audit_log WHERE entity_type = 'conversation' AND entity_id = 'conv_CnvAAAAAAA05'),
  'staff', 'an admin''s is staff too');

SELECT * FROM finish(true);
ROLLBACK;
