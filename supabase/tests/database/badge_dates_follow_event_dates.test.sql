-- pgTAP tests for the badge dates that follow an event's date (20261130020000, reworked in
-- 20270310000000 when events began to stand on a prickle): the event's start day is its prickle's
-- Eastern start day, and changing it moves the badges granted through that event, and nothing else.
--   * editing the event's own columns, or moving the prickle within the same Eastern day, leaves
--     badges alone (so legacy badges with their own dates survive);
--   * add_event_attendee dates a new badge with the prickle's Eastern day;
--   * a real change moves every badge of that event, including those legacy dates;
--   * another event's badges and manually awarded badges (event_id IS NULL) are never touched.
-- Acts as an admin, as the app does. Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f5a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'badgedate-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f5a4', 'badgedate-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f501', 'Badgedate Alice', 'badgedate-alice@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f502', 'Badgedate Bob', 'badgedate-bob@example.test', now(), 'active');

-- 03:00Z on the 5th is still the evening of the 4th in Eastern time, so the Eastern day is the 4th.
INSERT INTO public.prickles (id, source, type_id, title, start_time, end_time) VALUES
  ('prkl_BADGEDATE01', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Badgedate Event X', '2024-05-05 03:00:00+00', '2024-05-05 05:00:00+00'),
  ('prkl_BADGEDATE02', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Badgedate Event Y', '2024-05-05 03:00:00+00', '2024-05-05 05:00:00+00'),
  ('prkl_BADGEDATE03', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Badgedate Event X moved', '2024-05-12 15:00:00+00', '2024-05-12 16:00:00+00');
INSERT INTO public.community_events (id, slug, event_type, prickle_id) VALUES
  ('00000000-0000-4000-a000-00000000f511', 'badgedate-event-x', 'virtual_retreat', 'prkl_BADGEDATE01'),
  ('00000000-0000-4000-a000-00000000f512', 'badgedate-event-y', 'virtual_retreat', 'prkl_BADGEDATE02');

INSERT INTO public.badge_types (id, key, name, category, has_levels, is_automatic, event_id) VALUES
  ('00000000-0000-4000-a000-00000000f521', 'badgedate_event_x', 'Badgedate Event X', 'retreat', false, false, '00000000-0000-4000-a000-00000000f511'),
  ('00000000-0000-4000-a000-00000000f522', 'badgedate_event_y', 'Badgedate Event Y', 'retreat', false, false, '00000000-0000-4000-a000-00000000f512'),
  ('00000000-0000-4000-a000-00000000f523', 'badgedate_manual', 'Badgedate Manual', 'special', false, false, NULL);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "badgedate-dana@example.test", "role": "authenticated"}', true);

SELECT add_event_attendee('00000000-0000-4000-a000-00000000f511', '00000000-0000-4000-a000-00000000f501', '00000000-0000-4000-a000-00000000f5a4');
SELECT add_event_attendee('00000000-0000-4000-a000-00000000f511', '00000000-0000-4000-a000-00000000f502', '00000000-0000-4000-a000-00000000f5a4');
SELECT add_event_attendee('00000000-0000-4000-a000-00000000f512', '00000000-0000-4000-a000-00000000f501', '00000000-0000-4000-a000-00000000f5a4');
INSERT INTO public.member_badges (member_id, badge_type_id, occurred_at)
VALUES ('00000000-0000-4000-a000-00000000f501', '00000000-0000-4000-a000-00000000f523', '2024-05-04');
-- Bob's badge on event X carries a legacy date of its own.
UPDATE public.member_badges SET occurred_at = '2024-05-01'
WHERE member_id = '00000000-0000-4000-a000-00000000f502' AND event_id = '00000000-0000-4000-a000-00000000f511';

-- 0: add_event_attendee dated the badge with the prickle's Eastern day, not the UTC day.
RESET ROLE;
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f501' AND event_id = '00000000-0000-4000-a000-00000000f512'),
  '2024-05-04'::date,
  'a badge awarded through an event is dated with the prickle''s Eastern day'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "badgedate-dana@example.test", "role": "authenticated"}', true);

-- 1: editing something other than the date leaves the badges alone.
UPDATE public.community_events SET focus = 'Badgedate focus' WHERE id = '00000000-0000-4000-a000-00000000f511';
RESET ROLE;
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f502' AND event_id = '00000000-0000-4000-a000-00000000f511'),
  '2024-05-01'::date,
  'an edit of the event leaves the legacy badge date alone'
);

-- 2: moving the prickle within the same Eastern day changes nothing.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "badgedate-dana@example.test", "role": "authenticated"}', true);
UPDATE public.prickles SET start_time = '2024-05-04 17:00:00+00', end_time = '2024-05-04 18:00:00+00' WHERE id = 'prkl_BADGEDATE01';
RESET ROLE;
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f502' AND event_id = '00000000-0000-4000-a000-00000000f511'),
  '2024-05-01'::date,
  'moving the prickle within the same Eastern day leaves the legacy badge date alone'
);

-- 3-4: moving the prickle to another day moves every badge of the event, the legacy date included.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "badgedate-dana@example.test", "role": "authenticated"}', true);
UPDATE public.prickles SET start_time = '2024-05-11 15:00:00+00', end_time = '2024-05-11 16:00:00+00' WHERE id = 'prkl_BADGEDATE01';
RESET ROLE;
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f501' AND event_id = '00000000-0000-4000-a000-00000000f511'),
  '2024-05-11'::date,
  'moving the prickle moves the event''s badges to the new date'
);
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f502' AND event_id = '00000000-0000-4000-a000-00000000f511'),
  '2024-05-11'::date,
  'including a badge that had its own older date'
);

-- 4b: standing the event on another prickle dates its badges with that prickle.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "badgedate-dana@example.test", "role": "authenticated"}', true);
UPDATE public.community_events SET prickle_id = 'prkl_BADGEDATE03' WHERE id = '00000000-0000-4000-a000-00000000f511';
RESET ROLE;
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f501' AND event_id = '00000000-0000-4000-a000-00000000f511'),
  '2024-05-12'::date,
  'standing the event on another prickle moves its badges to that prickle''s day'
);

-- 5: another event's badge is untouched.
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f501' AND event_id = '00000000-0000-4000-a000-00000000f512'),
  '2024-05-04'::date,
  'a badge from another event keeps its date'
);

-- 6: a manually awarded badge (no event) is untouched.
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f501' AND badge_type_id = '00000000-0000-4000-a000-00000000f523'),
  '2024-05-04'::date,
  'a manually awarded badge keeps its date'
);

-- 7: no badge was added or removed along the way.
SELECT is(
  (SELECT count(*)::int FROM public.member_badges
   WHERE member_id IN ('00000000-0000-4000-a000-00000000f501', '00000000-0000-4000-a000-00000000f502')),
  4,
  'the badges themselves are unchanged in number'
);

SELECT * FROM finish(true);
ROLLBACK;
