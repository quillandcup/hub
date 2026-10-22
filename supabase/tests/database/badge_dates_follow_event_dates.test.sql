-- pgTAP tests for events_sync_badge_dates (20261130020000): changing an event's starts_at moves
-- the badges granted through that event to the new date, and nothing else.
--   * editing anything but starts_at, or setting the same date, leaves badges alone (so legacy
--     badges with their own dates survive);
--   * a real change moves every badge of that event, including those legacy dates;
--   * another event's badges and manually awarded badges (event_id IS NULL) are never touched.
-- Acts as an admin, as the app does. Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f5a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'badgedate-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f5a4', 'badgedate-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f501', 'Badgedate Alice', 'badgedate-alice@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f502', 'Badgedate Bob', 'badgedate-bob@example.test', now(), 'active');

INSERT INTO public.events (id, slug, title, event_type, starts_at, ends_at) VALUES
  ('00000000-0000-4000-a000-00000000f511', 'badgedate-event-x', 'Badgedate Event X', 'virtual_retreat', '2024-05-04', '2024-05-04'),
  ('00000000-0000-4000-a000-00000000f512', 'badgedate-event-y', 'Badgedate Event Y', 'virtual_retreat', '2024-05-04', '2024-05-04');

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

-- 1: editing something other than starts_at leaves the badges alone.
UPDATE public.events SET title = 'Badgedate Event X, renamed' WHERE id = '00000000-0000-4000-a000-00000000f511';
RESET ROLE;
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f502' AND event_id = '00000000-0000-4000-a000-00000000f511'),
  '2024-05-01'::date,
  'a title edit leaves the legacy badge date alone'
);

-- 2: setting starts_at to the value it already has changes nothing.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "badgedate-dana@example.test", "role": "authenticated"}', true);
UPDATE public.events SET starts_at = '2024-05-04' WHERE id = '00000000-0000-4000-a000-00000000f511';
RESET ROLE;
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f502' AND event_id = '00000000-0000-4000-a000-00000000f511'),
  '2024-05-01'::date,
  'writing the same starts_at leaves the legacy badge date alone'
);

-- 3-4: a real change moves every badge of the event, the legacy date included.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "badgedate-dana@example.test", "role": "authenticated"}', true);
UPDATE public.events SET starts_at = '2024-05-11', ends_at = '2024-05-11' WHERE id = '00000000-0000-4000-a000-00000000f511';
RESET ROLE;
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f501' AND event_id = '00000000-0000-4000-a000-00000000f511'),
  '2024-05-11'::date,
  'changing starts_at moves the event''s badges to the new date'
);
SELECT is(
  (SELECT occurred_at FROM public.member_badges
   WHERE member_id = '00000000-0000-4000-a000-00000000f502' AND event_id = '00000000-0000-4000-a000-00000000f511'),
  '2024-05-11'::date,
  'including a badge that had its own older date'
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
