-- pgTAP tests for event_attendees.ticket_source = 'transferred' and ticket_from_event_id (20271124200000):
-- the source check allows comped, gifted and transferred only, and the origin link keeps the attendee
-- and goes null when the origin event is deleted. Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f501', 'Transfer Ada', 'transfer-ada@example.test', now(), 'lead');
INSERT INTO public.prickles (id, source, start_time, end_time, title) VALUES
  ('prkl_TRANSFER0001', 'calendar', now(), now() + interval '1 hour', 'Transfer Event A'),
  ('prkl_TRANSFER0002', 'calendar', now(), now() + interval '1 hour', 'Transfer Event B');
INSERT INTO public.community_events (id, slug, event_type, prickle_id) VALUES
  ('00000000-0000-4000-a000-00000000f511', 'transfer-event-a', 'other', 'prkl_TRANSFER0001'),
  ('00000000-0000-4000-a000-00000000f512', 'transfer-event-b', 'other', 'prkl_TRANSFER0002');
INSERT INTO public.event_attendees (id, event_id, member_id) VALUES
  ('00000000-0000-4000-a000-00000000f521', '00000000-0000-4000-a000-00000000f512', '00000000-0000-4000-a000-00000000f501');

SELECT lives_ok(
  $$UPDATE public.event_attendees SET ticket_source = 'transferred', ticket_from_event_id = '00000000-0000-4000-a000-00000000f511' WHERE id = '00000000-0000-4000-a000-00000000f521'$$,
  'a transferred ticket can name its origin event'
);

SELECT throws_ok(
  $$UPDATE public.event_attendees SET ticket_from_event_id = 'evt_NOSUCHEVENT1' WHERE id = '00000000-0000-4000-a000-00000000f521'$$,
  '23503',
  NULL,
  'the origin must be an event'
);

SELECT lives_ok(
  $$UPDATE public.event_attendees SET ticket_source = 'comped', ticket_from_event_id = NULL WHERE id = '00000000-0000-4000-a000-00000000f521'$$,
  'comped is still allowed'
);
SELECT lives_ok(
  $$UPDATE public.event_attendees SET ticket_source = 'gifted' WHERE id = '00000000-0000-4000-a000-00000000f521'$$,
  'gifted is still allowed'
);

SELECT throws_ok(
  $$UPDATE public.event_attendees SET ticket_source = 'purchased' WHERE id = '00000000-0000-4000-a000-00000000f521'$$,
  '23514',
  NULL,
  'purchased is derived from Kajabi and not a stored source'
);

UPDATE public.event_attendees SET ticket_source = 'transferred', ticket_from_event_id = '00000000-0000-4000-a000-00000000f511' WHERE id = '00000000-0000-4000-a000-00000000f521';
DELETE FROM public.community_events WHERE id = '00000000-0000-4000-a000-00000000f511';

SELECT is(
  (SELECT count(*)::int FROM public.event_attendees WHERE id = '00000000-0000-4000-a000-00000000f521'),
  1,
  'deleting the origin event keeps the attendee'
);
SELECT is(
  (SELECT ticket_from_event_id FROM public.event_attendees WHERE id = '00000000-0000-4000-a000-00000000f521'),
  NULL,
  'and clears the link (no CHECK ties the origin to the source)'
);

SELECT * FROM finish(true);
ROLLBACK;
