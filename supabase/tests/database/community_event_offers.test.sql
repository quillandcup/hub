-- pgTAP tests for community_event_offers (20270605000000): the Kajabi offers that sell an event.
-- Admin only (a member sees and changes nothing), one event per offer, an event may have several
-- offers, and deleting the event removes its links. Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(15);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e0a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'eventoffer-admin@example.test'),
  ('00000000-0000-4000-a000-00000000e0a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'eventoffer-member@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e0a1', 'eventoffer-admin@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000e0a2', 'eventoffer-member@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.prickles (id, source, type_id, title, start_time, end_time) VALUES
  ('prkl_EVOFFER0001', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Offer Event A', '2097-05-05 15:00:00+00', '2097-05-05 17:00:00+00'),
  ('prkl_EVOFFER0002', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Offer Event B', '2097-06-05 15:00:00+00', '2097-06-05 17:00:00+00');
INSERT INTO public.community_events (id, slug, event_type, prickle_id) VALUES
  ('evt_EVOFFERAAAA1', 'offer-event-a', 'virtual_retreat', 'prkl_EVOFFER0001'),
  ('evt_EVOFFERAAAA2', 'offer-event-b', 'virtual_retreat', 'prkl_EVOFFER0002');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e0a1", "role": "authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.community_event_offers (event_id, kajabi_offer_id) VALUES ('evt_EVOFFERAAAA1', 'offer-1'), ('evt_EVOFFERAAAA1', 'offer-2')$$,
  'admin: an event can have several offers'
);
SELECT matches(
  (SELECT id FROM public.community_event_offers WHERE kajabi_offer_id = 'offer-1'),
  '^evo_[1-9A-HJ-NP-Za-km-z]{12}$',
  'ids are evo_ plus 12 base58 characters'
);
SELECT is((SELECT count(*)::int FROM public.community_event_offers), 2, 'admin: sees the links');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e0a2", "role": "authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.community_event_offers), 0, 'member: sees none');
SELECT throws_ok(
  $$INSERT INTO public.community_event_offers (event_id, kajabi_offer_id) VALUES ('evt_EVOFFERAAAA2', 'offer-9')$$,
  '42501', NULL,
  'member: cannot link an offer'
);
DELETE FROM public.community_event_offers WHERE kajabi_offer_id = 'offer-1';

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e0a1", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.community_event_offers WHERE kajabi_offer_id = 'offer-1'), 1, 'member: cannot unlink an offer');

DELETE FROM public.community_event_offers WHERE kajabi_offer_id = 'offer-2';
SELECT is((SELECT count(*)::int FROM public.community_event_offers), 1, 'admin: unlinks an offer');

-- One offer can serve two events (20270721 dropped the one-event-per-offer rule; the app keeps their days apart).
SELECT lives_ok(
  $$INSERT INTO public.community_event_offers (event_id, kajabi_offer_id) VALUES ('evt_EVOFFERAAAA2', 'offer-1')$$,
  'admin: an offer can be linked to a second event'
);
SELECT is((SELECT count(*)::int FROM public.community_event_offers WHERE kajabi_offer_id = 'offer-1'), 2, 'admin: both links are there');
DELETE FROM public.community_event_offers WHERE event_id = 'evt_EVOFFERAAAA2';

-- Purchase windows (20270720): inclusive days, either end optional, a link per event and offer.
SELECT lives_ok(
  $$INSERT INTO public.community_event_offers (event_id, kajabi_offer_id, purchased_from, purchased_until) VALUES ('evt_EVOFFERAAAA1', 'offer-3', '2026-02-01', '2026-02-01')$$,
  'admin: a window may be a single day'
);
SELECT throws_ok(
  $$INSERT INTO public.community_event_offers (event_id, kajabi_offer_id, purchased_from, purchased_until) VALUES ('evt_EVOFFERAAAA1', 'offer-4', '2026-02-02', '2026-02-01')$$,
  '23514', NULL,
  'a window must not end before it starts'
);
SELECT lives_ok(
  $$INSERT INTO public.community_event_offers (event_id, kajabi_offer_id, purchased_until) VALUES ('evt_EVOFFERAAAA1', 'offer-5', '2026-02-01')$$,
  'admin: a window may have only an end'
);
SELECT throws_ok(
  $$INSERT INTO public.community_event_offers (event_id, kajabi_offer_id) VALUES ('evt_EVOFFERAAAA1', 'offer-3')$$,
  '23505', NULL,
  'an event links an offer once'
);
UPDATE public.community_event_offers SET purchased_from = '2026-01-15' WHERE kajabi_offer_id = 'offer-3';
SELECT is(
  (SELECT purchased_from FROM public.community_event_offers WHERE kajabi_offer_id = 'offer-3'),
  '2026-01-15'::date,
  'admin: changes a window'
);

RESET ROLE;
DELETE FROM public.community_events WHERE id = 'evt_EVOFFERAAAA1';
SELECT is((SELECT count(*)::int FROM public.community_event_offers WHERE event_id = 'evt_EVOFFERAAAA1'), 0, 'deleting the event removes its links');

SELECT * FROM finish(true);
ROLLBACK;
