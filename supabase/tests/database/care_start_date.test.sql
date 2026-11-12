-- pgTAP tests for changing when a Hedgie Care care period started (docs/HEDGIE_CARE.md, "Starting in the past, and changing
-- a start"): no migration was needed, the update is the existing grant and policy, so this pins what that update does. A
-- community manager may move a start, the audit log records the intent once as a delta of opened_at and period_ends_on (and
-- nothing for the message bookkeeping that moves with it), and a move does not touch the one-open-per-member rule.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000cd01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cd-manager@example.test'),
  ('00000000-0000-4000-a000-00000000cd03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cd-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000cd01', 'cd-manager@example.test', 'community_manager'),
  ('00000000-0000-4000-a000-00000000cd03', 'cd-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_CareDateAAA1', 'Ada Example', 'cd-ada@example.test', now(), 'active');

-- The community manager starts one, as she would have, and then moves its start to an earlier day.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cd01", "email": "cd-manager@example.test", "role": "authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, channel, opened_at, period_ends_on, last_staff_message_at)
    VALUES ('care_CareDateA01', 'mbr_CareDateAAA1', '00000000-0000-4000-a000-00000000cd01', '00000000-0000-4000-a000-00000000cd01', 'check_in', 'slack_dm',
            '2026-03-20T15:00:00Z', '2026-04-19', '2026-03-20T15:00:00Z')$$,
  'a community manager starts a care period');
SELECT lives_ok(
  $$UPDATE public.care_engagements SET opened_at = '2026-03-10T16:00:00Z', period_ends_on = '2026-04-09', last_staff_message_at = '2026-03-10T04:00:00Z' WHERE id = 'care_CareDateA01'$$,
  'and may move its start, the last day and the placeholder first message together');
SELECT is(
  (SELECT period_ends_on::text FROM public.care_engagements WHERE id = 'care_CareDateA01'), '2026-04-09', 'the last day moved with it');

-- One open per member still holds after a move.
SELECT throws_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, channel, period_ends_on)
    VALUES ('mbr_CareDateAAA1', '00000000-0000-4000-a000-00000000cd01', 'welcome', 'slack_dm', current_date + 30)$$,
  '23505', NULL, 'a second open care period for the member is still refused');
RESET ROLE;

-- An admin moves a different one's start (a different actor, so the trigger does not fold it into the insert row, which it
-- does within one transaction for one actor).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cd03", "email": "cd-admin@example.test", "role": "authenticated"}', true);
SELECT lives_ok(
  $$UPDATE public.care_engagements SET opened_at = '2026-03-05T17:00:00Z', period_ends_on = '2026-04-04', last_staff_message_at = '2026-03-05T05:00:00Z' WHERE id = 'care_CareDateA01'$$,
  'an admin moves it again');
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareDateA01' AND action = 'update'),
  1, 'the move is one audit entry');
SELECT is(
  (SELECT (changes -> 'opened_at' ->> 'old') IS NOT NULL AND (changes -> 'opened_at' ->> 'new') IS NOT NULL
     AND (changes -> 'period_ends_on' ->> 'old') = '2026-04-09' AND (changes -> 'period_ends_on' ->> 'new') = '2026-04-04'
     FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareDateA01' AND action = 'update'),
  true, 'it records the before and after of the start and of the last day');
SELECT is(
  (SELECT actor_kind || ':' || member_id FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareDateA01' AND action = 'update'),
  'staff:mbr_CareDateAAA1', 'as staff, about the member');
SELECT ok(
  (SELECT NOT (changes ? 'updated_at') FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_CareDateA01' AND action = 'update'),
  'without the bookkeeping timestamp');

SELECT * FROM finish(true);
ROLLBACK;
