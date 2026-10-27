-- pgTAP tests for the audience chain (20270211000000): guests only at something announced publicly, and only
-- something listed in Events is announced publicly, for prickle types; guests only at an event announced
-- publicly. Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

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
  $$INSERT INTO public.events (slug, title, event_type, starts_at, ends_at, guests_allowed) VALUES ('audience-test-ev-a', 'A', 'other', '2097-01-01', '2097-01-01', true)$$,
  '23514', NULL, 'an event that allows guests must be announced publicly'
);
SELECT lives_ok(
  $$INSERT INTO public.events (slug, title, event_type, starts_at, ends_at, announced_publicly, guests_allowed) VALUES ('audience-test-ev-b', 'B', 'other', '2097-01-01', '2097-01-01', true, true)$$,
  'an event announced publicly may allow guests'
);
SELECT lives_ok(
  $$INSERT INTO public.events (slug, title, event_type, starts_at, ends_at) VALUES ('audience-test-ev-c', 'C', 'other', '2097-01-01', '2097-01-01')$$,
  'an event for members only is allowed'
);

SELECT * FROM finish(true);
ROLLBACK;
