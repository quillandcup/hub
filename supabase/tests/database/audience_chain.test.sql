-- pgTAP tests for the audience chain (20270211000000): guests only at something announced publicly, and only
-- something listed in Events is announced publicly, for prickle types; guests only at an event announced
-- publicly. Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

INSERT INTO public.prickles (id, source, start_time, end_time, title) VALUES
  ('prkl_AUDCHAIN001', 'calendar', '2097-01-01 15:00+00', '2097-01-01 16:00+00', 'A'),
  ('prkl_AUDCHAIN002', 'calendar', '2097-01-01 15:00+00', '2097-01-01 16:00+00', 'B'),
  ('prkl_AUDCHAIN003', 'calendar', '2097-01-01 15:00+00', '2097-01-01 16:00+00', 'C');

SELECT plan(10);

SELECT throws_ok(
  $$INSERT INTO public.prickle_types (name, normalized_name, announced_publicly) VALUES ('Audience Test A', 'audience-test-a', true)$$,
  '23514', NULL, 'a prickle type announced publicly must be listed in Events'
);
SELECT throws_ok(
  $$INSERT INTO public.prickle_types (name, normalized_name, listed_in_events, guests_allowed) VALUES ('Audience Test B', 'audience-test-b', true, true)$$,
  '23514', NULL, 'a prickle type that allows guests must be announced publicly'
);
SELECT throws_ok(
  $$INSERT INTO public.prickle_types (name, normalized_name, guests_allowed) VALUES ('Audience Test C', 'audience-test-c', true)$$,
  '23514', NULL, 'guests need public, which needs listed'
);
SELECT lives_ok(
  $$INSERT INTO public.prickle_types (name, normalized_name, listed_in_events, announced_publicly, guests_allowed) VALUES ('Audience Test D', 'audience-test-d', true, true, true)$$,
  'listed, public and guests is allowed'
);
SELECT lives_ok(
  $$INSERT INTO public.prickle_types (name, normalized_name, listed_in_events, announced_publicly) VALUES ('Audience Test E', 'audience-test-e', true, true)$$,
  'listed and public, members only, is allowed'
);
SELECT lives_ok(
  $$INSERT INTO public.prickle_types (name, normalized_name) VALUES ('Audience Test F', 'audience-test-f')$$,
  'none of them is allowed'
);
SELECT throws_ok(
  $$UPDATE public.prickle_types SET listed_in_events = false WHERE normalized_name = 'audience-test-d'$$,
  '23514', NULL, 'un-listing a type that is public is refused until public is cleared too'
);

SELECT throws_ok(
  $$INSERT INTO public.community_events (slug, event_type, prickle_id, guests_allowed) VALUES ('audience-test-ev-a', 'other', 'prkl_AUDCHAIN001', true)$$,
  '23514', NULL, 'an event that allows guests must be announced publicly'
);
SELECT lives_ok(
  $$INSERT INTO public.community_events (slug, event_type, prickle_id, announced_publicly, guests_allowed) VALUES ('audience-test-ev-b', 'other', 'prkl_AUDCHAIN002', true, true)$$,
  'an event announced publicly may allow guests'
);
SELECT lives_ok(
  $$INSERT INTO public.community_events (slug, event_type, prickle_id) VALUES ('audience-test-ev-c', 'other', 'prkl_AUDCHAIN003')$$,
  'an event for members only is allowed'
);

SELECT * FROM finish(true);
ROLLBACK;
