-- pgTAP tests for where an access event came from (20261128000100): the place and IP columns' checks,
-- and access_locations_at(), the latest located event before a time. Runs in one transaction that is rolled
-- back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000e0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'loc-ann@example.test'),
  ('00000000-0000-4000-a000-0000000e0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'loc-bea@example.test');

-- Ann: in Muncie in the morning, then in Boston in the evening; Bea: one located event, one without a place.
INSERT INTO public.access_events (user_id, path, is_page, created_at, ip_address, country, region, city) VALUES
  ('00000000-0000-4000-a000-0000000e0a01', '/dashboard', true, '2026-10-06 14:00:00+00', '203.0.113.7', 'US', 'IN', 'Muncie'),
  ('00000000-0000-4000-a000-0000000e0a01', '/courses',   true, '2026-10-06 14:30:00+00', '203.0.113.7', 'US', 'IN', 'Muncie'),
  ('00000000-0000-4000-a000-0000000e0a01', '/dashboard', true, '2026-10-06 23:00:00+00', '198.51.100.9', 'US', 'MA', 'Boston'),
  ('00000000-0000-4000-a000-0000000e0a02', '/dashboard', true, '2026-10-06 15:00:00+00', '2001:db8::1', 'GB', 'ENG', 'London'),
  ('00000000-0000-4000-a000-0000000e0a02', '/api/x',     false, '2026-10-06 16:00:00+00', NULL, NULL, NULL, NULL);

-- The columns' checks (the insert runs as the user, so the database backs up what the code validates).
SELECT throws_ok(
  $$INSERT INTO public.access_events (user_id, path, is_page, country) VALUES ('00000000-0000-4000-a000-0000000e0a01', '/x', true, 'usa')$$,
  '23514', NULL, 'a country is two capital letters');
SELECT throws_ok(
  $$INSERT INTO public.access_events (user_id, path, is_page, city) VALUES ('00000000-0000-4000-a000-0000000e0a01', '/x', true, repeat('x', 101))$$,
  '23514', NULL, 'a city is capped at 100 characters');
SELECT throws_ok(
  $$INSERT INTO public.access_events (user_id, path, is_page, ip_address) VALUES ('00000000-0000-4000-a000-0000000e0a01', '/x', true, 'not-an-ip'::text::inet)$$,
  '22P02', NULL, 'an ip must be a valid address');

-- Where a member was at a time: the latest located event at or before it.
SELECT is(
  (SELECT city FROM access_locations_at(ARRAY['00000000-0000-4000-a000-0000000e0a01']::uuid[], ARRAY['2026-10-06 14:45:00+00']::timestamptz[])),
  'Muncie', 'a visit in the morning is placed where the member was then');
SELECT is(
  (SELECT city FROM access_locations_at(ARRAY['00000000-0000-4000-a000-0000000e0a01']::uuid[], ARRAY['2026-10-06 23:00:05+00']::timestamptz[])),
  'Boston', 'and a visit in the evening where they had moved to');
SELECT is(
  (SELECT host(ip_address) FROM access_locations_at(ARRAY['00000000-0000-4000-a000-0000000e0a02']::uuid[], ARRAY['2026-10-06 16:30:00+00']::timestamptz[])),
  '2001:db8::1', 'an event without a place is skipped for the latest one that has it');
SELECT is(
  (SELECT count(*)::int FROM access_locations_at(ARRAY['00000000-0000-4000-a000-0000000e0a01']::uuid[], ARRAY['2026-10-05 12:00:00+00']::timestamptz[])),
  0, 'a time before any located event gets nothing');
SELECT is(
  (SELECT count(*)::int FROM access_locations_at(ARRAY['00000000-0000-4000-a000-0000000e0a01']::uuid[], ARRAY['2026-10-08 12:00:00+00']::timestamptz[])),
  0, 'and so does a time more than a day after the latest one');

-- Several pairs in one call keep their positions.
SELECT is(
  (SELECT array_agg(idx || ':' || city ORDER BY idx) FROM access_locations_at(
     ARRAY['00000000-0000-4000-a000-0000000e0a01', '00000000-0000-4000-a000-0000000e0a02', '00000000-0000-4000-a000-0000000e0a01']::uuid[],
     ARRAY['2026-10-06 14:45:00+00', '2026-10-06 15:30:00+00', '2026-10-06 23:30:00+00']::timestamptz[])),
  ARRAY['1:Muncie', '2:London', '3:Boston'], 'many pairs in one call, each at its own position');

SELECT * FROM finish(true);
ROLLBACK;
