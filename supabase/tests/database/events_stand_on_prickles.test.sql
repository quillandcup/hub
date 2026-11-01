-- pgTAP tests for 20270310000000 (an event stands on exactly one prickle):
--   * community_events.prickle_id is NOT NULL, UNIQUE and a foreign key; the copied columns are gone;
--   * community_event_details reads the schedule from the prickle: title (own, else the type's name), Eastern
--     start/end days, an event ending exactly at midnight ending the day before, a daylight saving day;
--   * hub_sessions: grants and RLS (members read, only admins write), the projection into source=hub
--     prickles with stable ids, orphan deletion, and the admins-only reprocess_hub_prickles_atomic.
-- Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(27);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e5a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'evtp-admin@example.test'),
  ('00000000-0000-4000-a000-00000000e5a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'evtp-member@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e5a1', 'evtp-admin@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000e5a2', 'evtp-member@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_EVTPHOST0001', 'Evtp Host', 'evtp-host@example.test', now(), 'active');

-- The event-only prickle type exists and is not a writing session.
SELECT is(
  (SELECT purpose || ':' || listed_in_events || ':' || requires_host FROM public.prickle_types WHERE normalized_name = 'event'),
  'social:true:false',
  'the event-only prickle type is social, listed in Events and takes no host'
);

SELECT is(public.org_timezone(), 'America/New_York', 'the org timezone for SQL is Eastern');

-- Prickles: titled, untitled (type name), 03:30Z (still the evening before in Eastern), ends at Eastern
-- midnight, and the 23-hour spring-forward day (2097-03-10 is the second Sunday of March).
INSERT INTO public.prickles (id, source, type_id, title, location, guest_speaker, host, start_time, end_time)
SELECT v.id, 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), v.title, v.location, v.guest, v.host, v.s::timestamptz, v.e::timestamptz
FROM (VALUES
  ('prkl_EVTPTEST0001', 'Open House', 'Lakehouse', 'Ada Example', 'mbr_EVTPHOST0001', '2097-05-01 13:00:00+00', '2097-05-01 15:00:00+00'),
  ('prkl_EVTPTEST0002', NULL,         NULL,        NULL,          NULL,               '2097-05-02 13:00:00+00', '2097-05-02 14:00:00+00'),
  ('prkl_EVTPTEST0003', 'Late',       NULL,        NULL,          NULL,               '2097-07-02 03:30:00+00', '2097-07-02 05:00:00+00'),
  ('prkl_EVTPTEST0004', 'Midnight',   NULL,        NULL,          NULL,               '2097-07-03 20:00:00+00', '2097-07-04 04:00:00+00'),
  ('prkl_EVTPTEST0005', 'Spring',     NULL,        NULL,          NULL,               '2097-03-10 05:00:00+00', '2097-03-11 04:00:00+00'),
  ('prkl_EVTPTEST0006', 'Spare',      NULL,        NULL,          NULL,               '2097-08-01 13:00:00+00', '2097-08-01 14:00:00+00')
) AS v(id, title, location, guest, host, s, e);

-- prickle_id is required.
SELECT throws_ok(
  $$INSERT INTO public.community_events (slug, event_type) VALUES ('evtp-none', 'other')$$,
  '23502', NULL, 'an event without a prickle is refused (NOT NULL)'
);
SELECT throws_ok(
  $$INSERT INTO public.community_events (slug, event_type, prickle_id) VALUES ('evtp-ghost', 'other', 'prkl_DOESNOTEXIST')$$,
  '23503', NULL, 'an event on a prickle that does not exist is refused (foreign key)'
);

INSERT INTO public.community_events (id, slug, event_type, prickle_id) VALUES
  ('evt_EVTPTEST0001', 'evtp-1', 'other', 'prkl_EVTPTEST0001'),
  ('evt_EVTPTEST0002', 'evtp-2', 'other', 'prkl_EVTPTEST0002'),
  ('evt_EVTPTEST0003', 'evtp-3', 'other', 'prkl_EVTPTEST0003'),
  ('evt_EVTPTEST0004', 'evtp-4', 'other', 'prkl_EVTPTEST0004'),
  ('evt_EVTPTEST0005', 'evtp-5', 'other', 'prkl_EVTPTEST0005');

SELECT throws_ok(
  $$INSERT INTO public.community_events (slug, event_type, prickle_id) VALUES ('evtp-dup', 'other', 'prkl_EVTPTEST0001')$$,
  '23505', NULL, 'a second event on the same prickle is refused (UNIQUE)'
);

SELECT is(
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'community_events'
   AND column_name IN ('title', 'description', 'location', 'speakers', 'host_name', 'start_time', 'end_time', 'starts_at', 'ends_at', 'calendar_event_id', 'overridden_fields')),
  0,
  'the schedule columns are gone from community_events'
);

-- community_event_details
SELECT is(
  (SELECT title || '|' || location || '|' || speakers || '|' || host_name || '|' || starts_at || '|' || ends_at FROM public.community_event_details WHERE id = 'evt_EVTPTEST0001'),
  'Open House|Lakehouse|Ada Example|Evtp Host|2097-05-01|2097-05-01',
  'community_event_details reads title, location, guest speaker, host and Eastern days from the prickle'
);
SELECT is((SELECT title FROM public.community_event_details WHERE id = 'evt_EVTPTEST0002'), 'Event', 'an untitled prickle shows its type''s name');
SELECT is(
  (SELECT starts_at::text || ' ' || ends_at::text FROM public.community_event_details WHERE id = 'evt_EVTPTEST0003'),
  '2097-07-01 2097-07-02',
  '03:30Z is the evening before in Eastern time; the event ends on the next Eastern day'
);
SELECT is(
  (SELECT starts_at::text || ' ' || ends_at::text FROM public.community_event_details WHERE id = 'evt_EVTPTEST0004'),
  '2097-07-03 2097-07-03',
  'an event ending exactly at Eastern midnight ends the day before'
);
SELECT is(
  (SELECT starts_at::text || ' ' || ends_at::text FROM public.community_event_details WHERE id = 'evt_EVTPTEST0005'),
  '2097-03-10 2097-03-10',
  'the 23-hour spring-forward day starts and ends on the same Eastern day'
);

-- Moving the prickle moves the event: nothing is copied.
UPDATE public.prickles SET title = 'Open House, renamed', start_time = '2097-05-09 13:00:00+00', end_time = '2097-05-09 15:00:00+00' WHERE id = 'prkl_EVTPTEST0001';
SELECT is(
  (SELECT title || '|' || starts_at FROM public.community_event_details WHERE id = 'evt_EVTPTEST0001'),
  'Open House, renamed|2097-05-09',
  'an event follows its prickle'
);

-- A prickle an event stands on cannot be deleted.
SELECT throws_ok(
  $$DELETE FROM public.prickles WHERE id = 'prkl_EVTPTEST0001'$$,
  '23503', NULL, 'a prickle with an event on it cannot be deleted'
);

-- The calendar reprocess keeps the prickle an event stands on when its calendar item is gone.
INSERT INTO bronze.calendar_events (id, google_event_id, summary, start_time, end_time, raw_data) VALUES
  ('00000000-0000-4000-a000-00000000e5c1', 'evtp-gone', 'Gone', '2097-09-01 13:00+00', '2097-09-01 14:00+00', '{}');
UPDATE public.prickles SET calendar_event_id = '00000000-0000-4000-a000-00000000e5c1', start_time = '2097-09-01 13:00+00', end_time = '2097-09-01 14:00+00' WHERE id = 'prkl_EVTPTEST0006';
INSERT INTO public.community_events (id, slug, event_type, prickle_id) VALUES ('evt_EVTPTEST0006', 'evtp-6', 'other', 'prkl_EVTPTEST0006');
SELECT public.reprocess_prickles_atomic('2097-08-31 00:00+00', '2097-09-02 00:00+00', '[]'::jsonb);
SELECT is(
  (SELECT count(*)::int FROM public.prickles WHERE id = 'prkl_EVTPTEST0006'),
  1,
  'reprocessing keeps a calendar prickle that an event stands on'
);

-- hub_sessions: projection
INSERT INTO public.hub_sessions (id, title, host, host_name, location, start_time, end_time) VALUES
  ('hsess_EVTPTEST001', 'Hub Gathering', NULL, 'Pat Example', 'Park', '2097-06-01 14:00+00', '2097-06-01 16:00+00');
SELECT public.project_hub_sessions();
SELECT is(
  (SELECT count(*)::int FROM public.prickles WHERE hub_session_id = 'hsess_EVTPTEST001' AND source = 'hub' AND title = 'Hub Gathering' AND location = 'Park'
   AND type_id = (SELECT id FROM public.prickle_types WHERE normalized_name = 'event')),
  1,
  'a hub session is projected into a hub prickle of the event-only type'
);
CREATE TEMP TABLE hub_prickle ON COMMIT DROP AS SELECT id FROM public.prickles WHERE hub_session_id = 'hsess_EVTPTEST001';
UPDATE public.hub_sessions SET title = 'Hub Gathering II' WHERE id = 'hsess_EVTPTEST001';
SELECT public.project_hub_sessions();
SELECT is(
  (SELECT p.title FROM public.prickles p WHERE p.id = (SELECT id FROM hub_prickle)),
  'Hub Gathering II',
  'projecting again updates the same prickle (its id is stable)'
);
INSERT INTO public.community_events (id, slug, event_type, prickle_id) VALUES ('evt_EVTPTEST0007', 'evtp-7', 'other', (SELECT id FROM hub_prickle));
SELECT is(
  (SELECT host_name FROM public.community_event_details WHERE id = 'evt_EVTPTEST0007'),
  'Pat Example',
  'a hub session''s free-text host shows as the event''s host'
);
SELECT throws_ok(
  $$DELETE FROM public.hub_sessions WHERE id = 'hsess_EVTPTEST001'$$,
  '23503', NULL, 'a hub session cannot be deleted while an event stands on its prickle'
);
DELETE FROM public.community_events WHERE id = 'evt_EVTPTEST0007';
DELETE FROM public.hub_sessions WHERE id = 'hsess_EVTPTEST001';
SELECT is(
  (SELECT count(*)::int FROM public.prickles WHERE id = (SELECT id FROM hub_prickle)),
  0,
  'deleting a hub session removes its prickle'
);
-- An orphan hub prickle (its session gone) is deleted by the projection.
INSERT INTO public.prickles (id, source, start_time, end_time) VALUES ('prkl_EVTPORPHAN01', 'hub', '2097-06-02 14:00+00', '2097-06-02 15:00+00');
SELECT public.project_hub_sessions();
SELECT is((SELECT count(*)::int FROM public.prickles WHERE id = 'prkl_EVTPORPHAN01'), 0, 'the projection deletes orphan hub prickles');

-- Grants and RLS
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e5a2", "email": "evtp-member@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT * FROM public.hub_sessions$$, 'a member can read hub sessions');
SELECT throws_ok(
  $$INSERT INTO public.hub_sessions (title, start_time, end_time) VALUES ('Sneaky', '2097-06-01 14:00+00', '2097-06-01 16:00+00')$$,
  '42501', NULL, 'a member cannot write hub sessions'
);
SELECT throws_ok($$SELECT public.reprocess_hub_prickles_atomic()$$, '42501', NULL, 'a member cannot run the hub projection');
SELECT is((SELECT count(*)::int FROM public.community_event_details WHERE id = 'evt_EVTPTEST0002'), 1, 'a member can read community_event_details');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e5a1", "email": "evtp-admin@example.test", "role": "authenticated"}', true);
SELECT lives_ok(
  $$INSERT INTO public.hub_sessions (title, start_time, end_time) VALUES ('Admin made', '2097-06-01 14:00+00', '2097-06-01 16:00+00')$$,
  'an admin can write hub sessions'
);
SELECT lives_ok($$SELECT public.reprocess_hub_prickles_atomic()$$, 'an admin can run the hub projection');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.hub_sessions$$, '42501', NULL, 'a signed-out visitor cannot read hub sessions');

SELECT * FROM finish(true);
ROLLBACK;
