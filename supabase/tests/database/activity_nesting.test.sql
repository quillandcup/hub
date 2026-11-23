-- The visible activity nests: Hedgie Care's "Activity during this plan" list is a subset of the community manager's Activity tab,
-- which is a subset of an admin's (all activity). A plain row-id comparison on one seeded member with a plan window.
--   * the plan list is computed here by the rule the repository runs (ActivityRepository.planActivity, src/lib/care-activity.ts):
--     the member's own participation and the Resend email rows inside the window (start included, end excluded: closed_at, or now
--     while open), and this plan's care rows (source 'care', related_id the plan) at any time;
--   * her feed is get_activity_feed with a member as a community manager; the admin feed the same call as an admin;
--   * every plan row is in hers; every row of hers is in the admin's, except the care rows, which an admin's feed says through
--     the audit row of the same event (get_activity_feed leaves source 'care' out for an admin: one entry per event);
--   * hers holds EVERY member_activities row about the member (no actor_kind or source filter), and the admin's holds extra
--     audit and session rows that hers lacks.
-- Rolled back; run with `pnpm test:pgtap`. tests/lib/care-activity.test.ts keeps the type lists below equal to the code's.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(13);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fd01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nest-manager@example.test'),
  ('00000000-0000-4000-a000-00000000fd02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nest-admin@example.test'),
  ('00000000-0000-4000-a000-00000000fd03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nest-ada@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000fd01', 'nest-manager@example.test'),
  ('00000000-0000-4000-a000-00000000fd02', 'nest-admin@example.test'),
  ('00000000-0000-4000-a000-00000000fd03', 'nest-ada@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000fd01', 'community_manager'),
  ('00000000-0000-4000-a000-00000000fd02', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_NestAAAAAA1', 'Ada Example', 'nest-ada@example.test', now(), 'active', '00000000-0000-4000-a000-00000000fd03'),
  ('mbr_NestAAAAAA2', 'Bo Example', 'nest-bo@example.test', now(), 'active', NULL);

-- The plan: closed, so its window is [opened_at, closed_at). Two plans of the member, so a care row of the other one shows the
-- plan list takes only its own.
INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, period_ends_on, opened_at, closed_at, ended_how) VALUES
  ('care_NestAAAAA1', 'mbr_NestAAAAAA1', '00000000-0000-4000-a000-00000000fd01', '00000000-0000-4000-a000-00000000fd01', 'check_in', current_date - 3, now() - interval '10 days', now() - interval '3 days', 'ran_its_course'),
  ('care_NestAAAAA2', 'mbr_NestAAAAAA1', '00000000-0000-4000-a000-00000000fd01', '00000000-0000-4000-a000-00000000fd01', 'check_in', current_date + 20, now() - interval '3 days', NULL, NULL);

-- Every kind of row the plan list shows (in-window participation, emails, this plan's care rows), and rows around it that it
-- does not: the instant the window ends, before it, a login, staff and system rows, a sudo row, another plan's care row.
INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, actor_user_id, engagement_value, occurred_at, source, related_id) VALUES
  -- in the plan list
  ('mbr_NestAAAAAA1', 'slack_message',       'communication', 'plan: at the start (included)', 'member', NULL, 1, now() - interval '10 days', 'slack', NULL),
  ('mbr_NestAAAAAA1', 'prickle_attended',    'attendance',    'plan: attended',                'member', NULL, 1, now() - interval '9 days',  'prickle_attendance', NULL),
  ('mbr_NestAAAAAA1', 'prickle_checkin',     'attendance',    'plan: check-in',                'member', NULL, 1, now() - interval '8 days',  'prickle_checkins', NULL),
  ('mbr_NestAAAAAA1', 'lesson_watched',      'learning',      'plan: lesson',                  'member', NULL, 1, now() - interval '7 days',  'courses', NULL),
  ('mbr_NestAAAAAA1', 'email_sent',          'communication', 'plan: email sent',              'system', NULL, 0, now() - interval '9 days',  'resend', NULL),
  ('mbr_NestAAAAAA1', 'email_opened',        'communication', 'plan: email opened',            'system', NULL, 0, now() - interval '9 days',  'resend', NULL),
  ('mbr_NestAAAAAA1', 'email_clicked',       'communication', 'plan: email clicked',           'system', NULL, 0, now() - interval '8 days',  'resend', NULL),
  ('mbr_NestAAAAAA1', 'email_bounced',       'communication', 'plan: email bounced',           'system', NULL, 0, now() - interval '7 days',  'resend', NULL),
  ('mbr_NestAAAAAA1', 'care_started',            'communication', 'plan: care started',   'staff', '00000000-0000-4000-a000-00000000fd01', 0, now() - interval '10 days', 'care', 'care_NestAAAAA1'),
  ('mbr_NestAAAAAA1', 'care_renewed',            'communication', 'plan: care renewed',   'staff', '00000000-0000-4000-a000-00000000fd01', 0, now() - interval '9 days',  'care', 'care_NestAAAAA1'),
  ('mbr_NestAAAAAA1', 'care_handover_offered',   'communication', 'plan: offered',        'staff', '00000000-0000-4000-a000-00000000fd01', 0, now() - interval '8 days',  'care', 'care_NestAAAAA1'),
  ('mbr_NestAAAAAA1', 'care_handover_accepted',  'communication', 'plan: accepted',       'staff', '00000000-0000-4000-a000-00000000fd01', 0, now() - interval '7 days',  'care', 'care_NestAAAAA1'),
  ('mbr_NestAAAAAA1', 'care_handover_declined',  'communication', 'plan: declined',       'staff', '00000000-0000-4000-a000-00000000fd01', 0, now() - interval '6 days',  'care', 'care_NestAAAAA1'),
  ('mbr_NestAAAAAA1', 'care_handover_cancelled', 'communication', 'plan: cancelled',      'staff', '00000000-0000-4000-a000-00000000fd01', 0, now() - interval '6 days',  'care', 'care_NestAAAAA1'),
  ('mbr_NestAAAAAA1', 'care_plan_claimed',       'communication', 'plan: claimed',        'staff', '00000000-0000-4000-a000-00000000fd01', 0, now() - interval '5 days',  'care', 'care_NestAAAAA1'),
  ('mbr_NestAAAAAA1', 'care_plan_taken_over',    'communication', 'plan: taken over',     'staff', '00000000-0000-4000-a000-00000000fd02', 0, now() - interval '4 days',  'care', 'care_NestAAAAA1'),
  ('mbr_NestAAAAAA1', 'care_closed',             'communication', 'plan: care closed',    'staff', '00000000-0000-4000-a000-00000000fd01', 0, now() - interval '3 days',  'care', 'care_NestAAAAA1'),
  -- not in the plan list, in her feed
  ('mbr_NestAAAAAA1', 'slack_message',       'communication', 'other: the instant it closed (excluded)', 'member', NULL, 1, now() - interval '3 days', 'slack', NULL),
  ('mbr_NestAAAAAA1', 'slack_message',       'communication', 'other: before the plan',   'member', NULL, 1, now() - interval '12 days', 'slack', NULL),
  ('mbr_NestAAAAAA1', 'hedgie_hub_login',    'general',       'other: a login',           'member', NULL, 0, now() - interval '6 days', 'access_events', NULL),
  ('mbr_NestAAAAAA1', 'outreach_touch',      'communication', 'other: a staff touch',     'staff', '00000000-0000-4000-a000-00000000fd01', 0, now() - interval '6 days', 'outreach_touches', NULL),
  ('mbr_NestAAAAAA1', 'sudo_started',        'general',       'other: sudo as the member', 'staff', '00000000-0000-4000-a000-00000000fd02', 0, now() - interval '5 days', 'sudo', NULL),
  ('mbr_NestAAAAAA1', 'prickle_commitment_created', 'attendance', 'other: sudo commitment', 'staff', '00000000-0000-4000-a000-00000000fd02', 0, now() - interval '5 days', 'prickle_commitments', NULL),
  ('mbr_NestAAAAAA1', 'hedgie_system_note',  'general',       'other: a system row',      'system', NULL, 0, now() - interval '5 days', 'system', NULL),
  ('mbr_NestAAAAAA1', 'care_started',        'communication', 'other: the next plan started', 'staff', '00000000-0000-4000-a000-00000000fd01', 0, now() - interval '3 days', 'care', 'care_NestAAAAA2'),
  ('mbr_NestAAAAAA2', 'slack_message',       'communication', 'other member',             'member', NULL, 1, now() - interval '5 days', 'slack', NULL);
-- The stamp trigger sets acting_as_member_id from the request header only, so what an admin did as the member is marked after.
UPDATE public.member_activities SET acting_as_member_id = 'mbr_NestAAAAAA1' WHERE title IN ('other: sudo as the member', 'other: sudo commitment');

-- What only an admin sees: an audited change to the record, and a page-visit session.
INSERT INTO public.audit_log (changed_by, actor_kind, entity_type, entity_id, action, changes, member_id, occurred_at) VALUES
  ('00000000-0000-4000-a000-00000000fd02', 'staff', 'member', 'mbr_NestAAAAAA1', 'update', '{"name": {"old": "Ada Old", "new": "Ada Example"}}', 'mbr_NestAAAAAA1', now() - interval '5 days');
INSERT INTO public.access_events (user_id, path, is_page, created_at) VALUES
  ('00000000-0000-4000-a000-00000000fd03', '/dashboard', true, now() - interval '4 days');

-- Where each reader's ids go, by whose they are.
CREATE TEMP TABLE nest (who text, id text, kind text);
GRANT ALL ON nest TO authenticated;

SET LOCAL ROLE authenticated;

-- The community manager: the plan list by the repository's rule, and her feed.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fd01", "email": "nest-manager@example.test", "role": "authenticated"}', true);
INSERT INTO nest
SELECT 'plan', 'activity:' || m.id, 'activity'
  FROM public.member_activities m
 WHERE m.member_id = 'mbr_NestAAAAAA1'
   AND (
     (m.source = 'care' AND m.related_id = 'care_NestAAAAA1')
     OR (m.occurred_at >= (SELECT opened_at FROM public.care_engagements WHERE id = 'care_NestAAAAA1')
         AND m.occurred_at < coalesce((SELECT closed_at FROM public.care_engagements WHERE id = 'care_NestAAAAA1'), now())
         AND (
           (m.actor_kind = 'member' AND m.activity_type IN ('prickle_attended', 'slack_message', 'slack_thread_reply', 'slack_reaction', 'prickle_checkin', 'prickle_checkin_updated', 'prickle_checkout', 'prickle_checkout_updated', 'prickle_commitment_created', 'lesson_watched', 'lesson_completed', 'writing_progress_logged'))
           OR (m.source = 'resend' AND m.activity_type IN ('email_sent', 'email_opened', 'email_clicked', 'email_bounced'))))
   );
INSERT INTO nest SELECT 'manager', event_id, kind FROM public.get_activity_feed(p_member_id := 'mbr_NestAAAAAA1', p_from := now() - interval '60 days', p_limit := 1000);

-- An admin: the same call.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fd02", "email": "nest-admin@example.test", "role": "authenticated"}', true);
INSERT INTO nest SELECT 'admin', event_id, kind FROM public.get_activity_feed(p_member_id := 'mbr_NestAAAAAA1', p_from := now() - interval '60 days', p_limit := 1000);

RESET ROLE;

-- 1. The plan list is what the rule says: 4 lines of participation, 4 emails, 9 care rows of this plan.
SELECT is((SELECT count(*)::int FROM nest WHERE who = 'plan'), 17,
  'the plan list: in-window participation, the emails, and this plan''s nine care rows (not the instant it closed, not before it, not a login, not staff or system rows, not another plan''s row)');
SELECT is((SELECT count(*)::int FROM nest n JOIN public.member_activities m ON 'activity:' || m.id = n.id WHERE n.who = 'plan' AND m.title LIKE 'other:%'), 0,
  'and none of the rows it must leave out is in it');

-- 2. The plan list is a subset of hers.
SELECT is_empty($$SELECT id FROM nest WHERE who = 'plan' EXCEPT SELECT id FROM nest WHERE who = 'manager'$$,
  'every row of the plan list is in the community manager''s feed');

-- 3. Hers is every member_activities row about the member (any actor, any source), and nothing else.
SELECT is_empty(
  $$SELECT 'activity:' || m.id FROM public.member_activities m
     WHERE (m.member_id = 'mbr_NestAAAAAA1' OR m.acting_as_member_id = 'mbr_NestAAAAAA1') AND m.occurred_at > now() - interval '60 days'
    EXCEPT SELECT id FROM nest WHERE who = 'manager'$$,
  'her feed holds every activity row of the member: staff, system, sudo-as-member, care and email rows too');
SELECT is_empty(
  $$SELECT id FROM nest WHERE who = 'manager'
    EXCEPT SELECT 'activity:' || m.id FROM public.member_activities m WHERE m.member_id = 'mbr_NestAAAAAA1' OR m.acting_as_member_id = 'mbr_NestAAAAAA1'$$,
  'and nothing that is not one');
SELECT is((SELECT array_agg(DISTINCT kind) FROM nest WHERE who = 'manager'), ARRAY['activity'], 'her feed has the activity kind only');
SELECT is((SELECT count(*)::int FROM nest n JOIN public.member_activities m ON 'activity:' || m.id = n.id WHERE n.who = 'manager' AND m.acting_as_member_id = 'mbr_NestAAAAAA1'), 2,
  'including what an admin did while viewing as the member');
SELECT is((SELECT count(*)::int FROM nest n JOIN public.member_activities m ON 'activity:' || m.id = n.id WHERE n.who = 'manager' AND m.source = 'care'), 10,
  'including all care rows (the nine of the plan and the next plan''s)');

-- 4. Hers is a subset of the admin's by row, except the care rows: the admin's feed leaves source care out (one entry per event)
--    and says each through the audit row of the plan. Everything else of hers is the admin's too.
SELECT is_empty(
  $$SELECT n.id FROM nest n JOIN public.member_activities m ON 'activity:' || m.id = n.id
     WHERE n.who = 'manager' AND m.source IS DISTINCT FROM 'care'
    EXCEPT SELECT id FROM nest WHERE who = 'admin'$$,
  'every row of the community manager''s feed that is not a care row is in the admin''s feed');
SELECT is((SELECT count(*)::int FROM nest n JOIN public.member_activities m ON 'activity:' || m.id = n.id WHERE n.who = 'admin' AND m.source = 'care'), 0,
  'KNOWN GAP: the admin feed leaves the care rows out, by the owner''s earlier decision (one entry per care event), so by row id they are hers only');
SELECT cmp_ok((SELECT count(*) FROM nest WHERE who = 'admin' AND kind = 'audit'), '>=', 2::bigint,
  'the admin''s feed has the audit rows that say the care events and the change to the record (the care rows'' counterpart)');

-- 5. The admin's feed has extra rows hers lacks: audit and session.
SELECT cmp_ok((SELECT count(*) FROM nest WHERE who = 'admin' AND kind = 'audit' AND id NOT IN (SELECT id FROM nest WHERE who = 'manager')), '>=', 1::bigint, 'the admin''s feed has audit rows hers lacks');
SELECT cmp_ok((SELECT count(*) FROM nest WHERE who = 'admin' AND kind = 'session' AND id NOT IN (SELECT id FROM nest WHERE who = 'manager')), '>=', 1::bigint, 'and a session row hers lacks');

SELECT * FROM finish(true);
ROLLBACK;
