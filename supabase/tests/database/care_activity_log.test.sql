-- pgTAP tests for 20270730000000_care_activity_log.sql: Hedgie Care in the Activity Log.
--   * the audit rows of a care plan never carry what staff typed (the note and next step are redacted, the rest of the change stays);
--   * the central feed says a care plan's events once: the audit row is listed, the care rows of member_activities are not, and the
--     second audit row of a renewal (the old plan closed as "renewed") is not, while the count says the same as the list;
--   * a member reads their own activity except the care rows about them, and admins and the community manager read them.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(21);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000ae01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cal-manager@example.test'),
  ('00000000-0000-4000-a000-00000000ae02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cal-admin@example.test'),
  ('00000000-0000-4000-a000-00000000ae03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cal-ada@example.test'),
  ('00000000-0000-4000-a000-00000000ae04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cal-bo@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000ae01', 'cal-manager@example.test'),
  ('00000000-0000-4000-a000-00000000ae02', 'cal-admin@example.test'),
  ('00000000-0000-4000-a000-00000000ae03', 'cal-ada@example.test'),
  ('00000000-0000-4000-a000-00000000ae04', 'cal-bo@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000ae01', 'community_manager'),
  ('00000000-0000-4000-a000-00000000ae02', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_CareLogAAAA1', 'Ada Example', 'cal-ada@example.test', now(), 'active', '00000000-0000-4000-a000-00000000ae03'),
  ('mbr_CareLogAAAA2', 'Bo Example', 'cal-bo@example.test', now(), 'active', '00000000-0000-4000-a000-00000000ae04');

-- Written by the system (no signed-in person), so a person's later change is an entry of its own and is not folded into the insert.
INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, period_ends_on, notes, next_step)
VALUES ('care_CareLogAAAA1', 'mbr_CareLogAAAA1', '00000000-0000-4000-a000-00000000ae01', '00000000-0000-4000-a000-00000000ae01', 'check_in', current_date + 30,
        'secret opening note', 'secret opening step');

------------------------------------------------------------------------------------------------
-- 1. What staff typed is never in the audit log.
------------------------------------------------------------------------------------------------

SELECT is(
  (SELECT changes -> 'notes' ->> 'new' FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareLogAAAA1' AND action = 'insert'),
  '[redacted]', 'the insert says a note was written, not what it said');
SELECT is(
  (SELECT changes -> 'next_step' ->> 'new' FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareLogAAAA1' AND action = 'insert'),
  '[redacted]', 'and a next step');
SELECT is(
  (SELECT changes -> 'reason' ->> 'new' FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareLogAAAA1' AND action = 'insert'),
  'check_in', 'while the rest of the row, a fixed choice, is logged as before');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ae01", "email": "cal-manager@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$UPDATE public.care_engagements SET notes = 'secret changed note', next_step = 'secret changed step', follow_up_on = current_date + 3 WHERE id = 'care_CareLogAAAA1'$$, 'staff edit the note, the next step and the follow-up day');
RESET ROLE;
SELECT is(
  (SELECT changes -> 'notes' ->> 'new' || '/' || (changes -> 'notes' ->> 'old') || '/' || (changes -> 'next_step' ->> 'new') FROM public.audit_log
    WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareLogAAAA1' AND action = 'update' AND changes ? 'follow_up_on'),
  '[redacted]/[redacted]/[redacted]', 'an edit says the note and next step changed, never to what');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'care_engagement' AND changes::text LIKE '%secret%'),
  0, 'and no text anywhere in any audit row of a care plan');
SELECT is(
  (SELECT changes -> 'follow_up_on' ->> 'new' FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareLogAAAA1' AND action = 'update' AND changes ? 'follow_up_on'),
  (current_date + 3)::text, 'a day she set is logged: it is not typed text');

------------------------------------------------------------------------------------------------
-- 2. The feed says a care plan's events once.
------------------------------------------------------------------------------------------------

-- A renewal and a close, and the care rows the actions write beside them.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ae01", "email": "cal-manager@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT * FROM public.renew_care_engagement('care_CareLogAAAA1', current_date + 60, '00000000-0000-4000-a000-00000000ae01', now(), 'why we renew')$$, 'the owner renews');
SELECT lives_ok(
  $$INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, actor_user_id, engagement_value, occurred_at, source, related_id)
    VALUES ('mbr_CareLogAAAA1', 'care_renewed', 'communication', 'Renewed a care plan', 'staff', '00000000-0000-4000-a000-00000000ae01', 0, now(), 'care', 'care_CareLogAAAA1'),
           ('mbr_CareLogAAAA1', 'care_handover_offered', 'communication', 'Offered a care plan to a colleague', 'staff', '00000000-0000-4000-a000-00000000ae01', 0, now(), 'care', 'care_CareLogAAAA1')$$,
  'she writes the care rows of the timeline');
RESET ROLE;
INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, engagement_value, occurred_at, source, related_id)
VALUES ('mbr_CareLogAAAA1', 'slack_message', 'communication', 'Posted in #writing', 'member', 5, now(), 'slack', 'cal-slack-1');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ae02", "email": "cal-admin@example.test", "role": "authenticated"}', true);
-- The audit log folds one person's updates to a row within one transaction into a single entry, and this file is one
-- transaction: the manager's edit above and her close of the old plan on renewal are one entry here (two in production,
-- where they happen minutes apart). An edit by someone else is an entry of its own, which is the edit the feed must keep.
SELECT lives_ok($$UPDATE public.care_engagements SET next_step = 'secret later step', follow_up_on = current_date + 5 WHERE member_id = 'mbr_CareLogAAAA1' AND closed_at IS NULL$$, 'an admin edits the renewed plan');
SELECT is(
  (SELECT count(*)::int FROM public.get_activity_feed(p_member_id := 'mbr_CareLogAAAA1', p_from := now() - interval '1 day', p_limit := 100) WHERE source = 'care'),
  0, 'the feed lists no care row of the timeline: the audit rows say the same events');
SELECT is(
  (SELECT count(*)::int FROM public.get_activity_feed(p_member_id := 'mbr_CareLogAAAA1', p_from := now() - interval '1 day', p_limit := 100) WHERE source = 'audit_log' AND entity_type = 'care_engagement' AND event_type = 'insert'),
  2, 'it lists the start and the renewal (the plan''s insert rows)');
SELECT is(
  (SELECT count(*)::int FROM public.get_activity_feed(p_member_id := 'mbr_CareLogAAAA1', p_from := now() - interval '1 day', p_limit := 100)
    WHERE source = 'audit_log' AND entity_type = 'care_engagement' AND data #>> '{ended_how,new}' = 'renewed'),
  0, 'but not the second audit row of a renewal, the old plan closed as renewed');
SELECT is(
  (SELECT count(*)::int FROM public.get_activity_feed(p_member_id := 'mbr_CareLogAAAA1', p_from := now() - interval '1 day', p_limit := 100)
    WHERE source = 'audit_log' AND entity_type = 'care_engagement' AND event_type = 'update'),
  1, 'while the edit stays');
SELECT is(
  (SELECT count(*)::int FROM public.get_activity_feed(p_member_id := 'mbr_CareLogAAAA1', p_from := now() - interval '1 day', p_limit := 100) WHERE source = 'slack'),
  1, 'other activity is listed as before');
SELECT is(
  public.count_activity_feed(p_member_id := 'mbr_CareLogAAAA1', p_from := now() - interval '1 day'),
  (SELECT count(*)::int FROM public.get_activity_feed(p_member_id := 'mbr_CareLogAAAA1', p_from := now() - interval '1 day', p_limit := 100)),
  'and the count is the same as the list');

------------------------------------------------------------------------------------------------
-- 3. A member reads their own activity except the care rows about them.
------------------------------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ae03", "email": "cal-ada@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.member_activities WHERE source = 'slack' AND member_id = 'mbr_CareLogAAAA1'), 1, 'a member reads their own activity');
SELECT is((SELECT count(*)::int FROM public.member_activities WHERE source = 'care'), 0, 'but not the care rows about them');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ae04", "email": "cal-bo@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.member_activities WHERE member_id = 'mbr_CareLogAAAA1'), 0, 'and another member reads nobody else''s');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ae01", "email": "cal-manager@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.member_activities WHERE source = 'care' AND member_id = 'mbr_CareLogAAAA1'), 2, 'the community manager reads them');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ae02", "email": "cal-admin@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.member_activities WHERE source = 'care' AND member_id = 'mbr_CareLogAAAA1'), 2, 'and so does an admin');

SELECT * FROM finish(true);
ROLLBACK;
